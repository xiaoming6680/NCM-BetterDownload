using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Threading;
using System.Web.Script.Serialization;

namespace NcmBetterDownload {
    public sealed class Job {
        public string id = "";
        public string source = "";
        public string target = "";
        // Filled in by the plugin once asked: the LRC text, "" when the song has none, and a note when fetching failed.
        public string lyrics;
        public string lyricsNote;
    }
    public sealed class ScanRequest {
        public string id = "";
        public string root = "";
    }
    public sealed class LyricsOptions {
        public bool enabled;
        public bool file;
        // How long a song waits for its lyrics before it is converted without them, in milliseconds.
        public long wait = 15000;
    }
    public sealed class Control {
        public string session = "";
        public long heartbeat;
        public bool enabled;
        public string state = "";
        public long idle;
        public ScanRequest scan;
        public LyricsOptions lyrics;
        public Job[] jobs = new Job[0];
    }
    public sealed class Receipt {
        public string signature;
        public string output;
        public long length;
        public long written;
        // True while the output is still exactly the file the worker wrote.
        public bool Intact() {
            if (String.IsNullOrEmpty(output) || !File.Exists(output)) return false;
            var file = new FileInfo(output);
            return file.Length == length && file.LastWriteTimeUtc.Ticks == written;
        }
    }
    public sealed class Extracted {
        public string path = "";
        public string warning = "";
        public bool lyrics;
    }
    public static class Worker {
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
        static readonly Encoding Utf8 = new UTF8Encoding(false);
        static readonly List<object> Events = new List<object>();
        static readonly Dictionary<string, object> Results = new Dictionary<string, object>();
        static readonly Dictionary<string, int> Attempts = new Dictionary<string, int>();
        // Job ID → when its lyrics were first asked for, and the song ID they were asked by.
        static readonly Dictionary<string, KeyValuePair<DateTime, string>> LyricsAsked = new Dictionary<string, KeyValuePair<DateTime, string>>();
        static Dictionary<string, Receipt> Receipts = new Dictionary<string, Receipt>(StringComparer.OrdinalIgnoreCase);
        static string ControlPath, StatusPath, ReceiptPath, Session, ScanId;
        static int Converted, Failed;
        static DateTime LastStatus, LastAlive, LastControlAt, LastBusy;
        static Control LastControl;
        static object Activity, Scan, LyricsRequest;
        static string ActivityState = "", CurrentJob = "", CurrentPath = "", CurrentCover = "", CurrentFormat = "";
        static bool CurrentLyrics;
        public static long Now() { return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds; }
        public static string Full(string path) { return Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar); }
        public static string Signature(FileInfo file) { return file.Length + ":" + file.LastWriteTimeUtc.Ticks; }
        public static void WriteJson(string path, object value) {
            string temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try {
                File.WriteAllText(temp, Json.Serialize(value), Utf8);
                if (File.Exists(path)) File.Replace(temp, path, null); else File.Move(temp, path);
            } finally { try { if (File.Exists(temp)) File.Delete(temp); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
        }
        // BetterNCM reads files without FILE_SHARE_DELETE, so File.Replace fails while the plugin polls status.json.
        static bool TryWriteJson(string path, object value) {
            for (int attempt = 0; ; attempt++) {
                try { WriteJson(path, value); return true; }
                catch (Exception e) {
                    if (!(e is IOException) && !(e is UnauthorizedAccessException)) throw;
                    if (attempt >= 4) return false;
                    Thread.Sleep(10 * (attempt + 1));
                }
            }
        }
        static Control ReadControl() {
            for (int attempt = 0; ; attempt++) {
                try {
                    string text;
                    // Share write and delete so the plugin can rewrite control.json while it is being read.
                    using (var stream = new FileStream(ControlPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                    using (var reader = new StreamReader(stream, Utf8)) text = reader.ReadToEnd();
                    var result = Json.Deserialize<Control>(text);
                    if (result == null) throw new InvalidDataException("配置正在写入。");
                    return result;
                } catch { if (attempt >= 3) throw; Thread.Sleep(20); }
            }
        }
        // The plugin rewrites control.json in place; a briefly unreadable file keeps the last good copy.
        static Control Current() {
            try { LastControl = ReadControl(); LastControlAt = DateTime.UtcNow; }
            catch { if (LastControl == null || DateTime.UtcNow - LastControlAt > TimeSpan.FromSeconds(5)) throw; }
            return LastControl;
        }
        static bool Alive(Control c) { return c.enabled && c.session == Session && Now() - c.heartbeat < 15000 && Now() >= c.heartbeat - 5000; }
        static bool Alive() {
            try { return Alive(Current()); }
            catch { return false; }
        }
        static bool ContinueConversion() {
            if (DateTime.UtcNow - LastAlive < TimeSpan.FromMilliseconds(100)) return true;
            LastAlive = DateTime.UtcNow; return Alive();
        }
        static TimeSpan IdleLimit(Control control) { return TimeSpan.FromMilliseconds(control.idle > 0 ? Math.Max(1000, Math.Min(control.idle, 600000)) : 60000); }
        static void Report(string state, string message, string path = "", bool add = true, int percent = 0, string warning = "") {
            if (state == "converting" || state == "success" || state == "error" || (state == "stopped" && ActivityState == "converting")) {
                Activity = new { id = CurrentJob, state, message, path = path.Length > 0 ? path : CurrentPath, output = state == "success" ? path : "", percent = state == "success" ? 100 : percent, warning, cover = CurrentCover, format = CurrentFormat, lyrics = state == "success" && CurrentLyrics };
                ActivityState = state;
            }
            if (add) {
                Events.Insert(0, new { time = Now(), state, message, path });
                if (Events.Count > 30) Events.RemoveAt(30);
            }
            // Status is advisory: a failed write is retried by the next report and never fails a conversion.
            if (TryWriteJson(StatusPath, new { session = Session, heartbeat = Now(), state, message, converted = Converted, failed = Failed, events = Events, activity = Activity, results = Results, scan = Scan, lyrics = LyricsRequest })) LastStatus = DateTime.UtcNow;
        }
        public static string UnlockTarget(string source) {
            var parts = Full(source).Split(Path.DirectorySeparatorChar);
            int vip = Array.FindIndex(parts, p => p.Equals("VipSongsDownload", StringComparison.OrdinalIgnoreCase));
            if (vip < 1 || vip >= parts.Length - 1 || parts.Skip(vip + 1).Take(parts.Length - vip - 2).Any(p => p.Equals("unlock", StringComparison.OrdinalIgnoreCase))) return null;
            return String.Join(Path.DirectorySeparatorChar.ToString(), parts.Take(vip + 1).Concat(new [] { "unlock" }).Concat(parts.Skip(vip + 1)));
        }
        public static void Validate(Job job) {
            if (String.IsNullOrEmpty(job.id) || String.IsNullOrEmpty(job.source) || !Path.IsPathRooted(job.source) || !Path.IsPathRooted(job.target)) throw new InvalidDataException("无效的下载任务。");
            string source = Full(job.source);
            if (!Path.GetExtension(source).Equals(".ncm", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("任务不是 NCM 文件。");
            string expected = UnlockTarget(source);
            if (expected == null) throw new InvalidDataException("只处理 VipSongsDownload 中的下载完成任务。");
            if (!Full(job.target).Equals(expected, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("输出必须位于 VipSongsDownload\\unlock。");
            for (var parent = new DirectoryInfo(Path.GetDirectoryName(source)); parent != null; parent = parent.Parent)
                if ((parent.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("源路径包含目录链接。");
            if ((File.GetAttributes(source) & FileAttributes.ReparsePoint) != 0) throw new IOException("源文件为链接。");
        }
        // The card shows album art from a copy of the embedded cover; nothing is decoded here or fetched online.
        static string SaveCover(string id, byte[] cover) {
            string mime = Metadata.Mime(cover), name = new string(id.Where(c => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-').ToArray());
            if (mime == null || cover.Length > 4 * 1024 * 1024 || name.Length == 0) return "";
            try {
                string dir = Path.Combine(Path.GetDirectoryName(ControlPath), "covers");
                Directory.CreateDirectory(dir);
                string path = Path.Combine(dir, name + (mime == "image/png" ? ".png" : ".jpg"));
                File.WriteAllBytes(path, cover);
                // Pruning is best effort: an old cover the plugin is reading must not cost this one.
                try { foreach (var old in new DirectoryInfo(dir).GetFiles().OrderByDescending(f => f.LastWriteTimeUtc).Skip(8)) old.Delete(); }
                catch (IOException) { } catch (UnauthorizedAccessException) { }
                return path;
            } catch (IOException) { return ""; }
            catch (UnauthorizedAccessException) { return ""; }
        }
        // True while the song should keep waiting for the plugin to hand over its lyrics; the request stays in status.json meanwhile.
        static bool WaitForLyrics(Job job, LyricsOptions options) {
            KeyValuePair<DateTime, string> asked;
            if (!LyricsAsked.TryGetValue(job.id, out asked)) {
                string musicId = Ncm.MusicId(job.source);
                if (musicId.Length == 0) return false;
                LyricsAsked[job.id] = asked = new KeyValuePair<DateTime, string>(DateTime.UtcNow, musicId);
                LyricsRequest = new { id = job.id, musicId };
                Report("converting", "正在获取歌词", job.source, false);
            }
            if (DateTime.UtcNow - asked.Key >= TimeSpan.FromMilliseconds(Math.Max(0, Math.Min(options.wait, 60000)))) return false;
            LyricsRequest = new { id = job.id, musicId = asked.Value };
            return true;
        }
        // An .lrc beside the song for players and car stereos that only read those; an existing file is never replaced.
        static string SaveLyricsFile(string audio, string lyrics) {
            string path = Path.ChangeExtension(audio, ".lrc");
            if (File.Exists(path) || Directory.Exists(path)) return "";
            string temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try {
                // UTF-8 with a BOM and CRLF: older players otherwise read Chinese lyrics as the ANSI code page.
                File.WriteAllText(temp, lyrics.Replace("\r\n", "\n").Replace("\n", "\r\n"), new UTF8Encoding(true));
                File.Move(temp, path);
                return "";
            } catch (Exception e) {
                if (!(e is IOException) && !(e is UnauthorizedAccessException)) throw;
                return "歌词文件未保存";
            } finally { try { if (File.Exists(temp)) File.Delete(temp); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
        }
        static void Finish(Job job, string state, string path, string message, string warning = "") {
            Attempts.Remove(job.id); LyricsAsked.Remove(job.id);
            Results[job.id] = new { state, output = state == "success" ? path : "", message, warning };
            Report(state, message, path, true, 0, warning);
        }
        // Returns true while any listed job still needs work.
        static bool Process(Control control, bool once) {
            var jobs = control.jobs ?? new Job[0];
            // Results live only as long as the plugin still lists the job.
            foreach (var id in Results.Keys.Where(id => !jobs.Any(job => job.id == id)).ToList()) Results.Remove(id);
            foreach (var id in LyricsAsked.Keys.Where(id => !jobs.Any(job => job.id == id)).ToList()) LyricsAsked.Remove(id);
            bool pending = false, wantLyrics = control.lyrics != null && control.lyrics.enabled;
            LyricsRequest = null;
            foreach (var job in jobs) {
                if (Results.ContainsKey(job.id)) continue;
                pending = true;
                if (!once && !Alive()) return true;
                CurrentJob = job.id; CurrentPath = job.source; CurrentCover = ""; CurrentFormat = ""; CurrentLyrics = false;
                try {
                    Validate(job);
                    string signature = Signature(new FileInfo(job.source));
                    Receipt receipt;
                    Receipts.TryGetValue(job.source, out receipt);
                    if (receipt != null && receipt.signature == signature && File.Exists(receipt.output) && new FileInfo(receipt.output).Length == receipt.length) {
                        Finish(job, "success", receipt.output, "此下载已完成转换"); continue;
                    }
                    // Lyrics are online, so the plugin fetches them: ask by song ID and give it a little while before converting without.
                    string lyrics = wantLyrics && job.lyrics != null && job.lyrics.Length <= 256 * 1024 ? job.lyrics : "";
                    if (wantLyrics && job.lyrics == null && WaitForLyrics(job, control.lyrics)) return true;
                    LyricsRequest = null;
                    Report("converting", "正在转换", job.source);
                    DateTime progressAt = DateTime.MinValue;
                    var saved = Ncm.Extract(job.source, job.target, true, once ? (Func<bool>)(() => true) : ContinueConversion, signature, (done, total) => {
                        if (DateTime.UtcNow - progressAt < TimeSpan.FromMilliseconds(200)) return;
                        progressAt = DateTime.UtcNow;
                        Report("converting", "正在转换", job.source, false, (int)Math.Min(98, done * 98 / total));
                    }, receipt, (format, cover) => {
                        CurrentFormat = format.TrimStart('.').ToUpperInvariant(); CurrentCover = SaveCover(job.id, cover);
                        Report("converting", "正在转换", job.source, false);
                    }, lyrics);
                    var output = new FileInfo(saved.path);
                    Receipts[job.source] = new Receipt { signature = signature, output = saved.path, length = output.Length, written = output.LastWriteTimeUtc.Ticks };
                    TryWriteJson(ReceiptPath, Receipts);
                    Converted++;
                    var notes = new List<string>();
                    if (saved.warning.Length > 0) notes.Add(saved.warning);
                    if (wantLyrics && !String.IsNullOrEmpty(job.lyricsNote)) notes.Add(job.lyricsNote);
                    CurrentLyrics = saved.lyrics;
                    if (saved.lyrics && control.lyrics.file) { string note = SaveLyricsFile(saved.path, lyrics); if (note.Length > 0) notes.Add(note); }
                    string warning = String.Join("；", notes);
                    Finish(job, "success", saved.path, warning.Length > 0 ? "音频已保存；" + warning : saved.lyrics ? "音频、歌曲信息与歌词已保存" : "音频与歌曲信息已保存", warning);
                } catch (OperationCanceledException) { return true; }
                catch (Exception error) {
                    int attempt; Attempts.TryGetValue(job.id, out attempt); Attempts[job.id] = ++attempt;
                    if (!once && error is IOException && attempt < 20) {
                        Report("converting", "等待客户端释放文件", job.source, false); return true;
                    }
                    Failed++; Finish(job, "error", job.source, error.Message);
                }
            }
            if (DateTime.UtcNow - LastStatus > TimeSpan.FromSeconds(2)) Report("ready", "已就绪，等待下载完成", "", false);
            return pending;
        }
        // A search the user started from the settings page. The plugin turns the reported files into jobs.
        static object Find(ScanRequest request) {
            var files = new List<string>();
            int skipped = 0, seen = 0; bool more = false;
            try {
                if (String.IsNullOrEmpty(request.root) || !Path.IsPathRooted(request.root)) throw new InvalidDataException("下载目录无效。");
                string root = Full(request.root);
                if (!Path.GetFileName(root).Equals("VipSongsDownload", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("只能查找 VipSongsDownload 目录。");
                if (!Directory.Exists(root)) throw new DirectoryNotFoundException("下载目录中还没有 VipSongsDownload。");
                for (var parent = new DirectoryInfo(root); parent != null; parent = parent.Parent)
                    if ((parent.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("下载目录包含目录链接。");
                var folders = new Stack<KeyValuePair<DirectoryInfo, int>>();
                folders.Push(new KeyValuePair<DirectoryInfo, int>(new DirectoryInfo(root), 0));
                while (folders.Count > 0 && !more) {
                    var folder = folders.Pop();
                    FileSystemInfo[] entries;
                    try { entries = folder.Key.GetFileSystemInfos(); }
                    catch (Exception e) { if (folder.Value == 0 || (!(e is IOException) && !(e is UnauthorizedAccessException))) throw; continue; }
                    foreach (var entry in entries) {
                        if (++seen > 50000) { more = true; break; }
                        if (seen % 500 == 0 && DateTime.UtcNow - LastStatus > TimeSpan.FromSeconds(1)) Report("scanning", "正在查找已有下载", "", false);
                        if ((entry.Attributes & FileAttributes.ReparsePoint) != 0) continue;
                        var directory = entry as DirectoryInfo;
                        if (directory != null) {
                            if (folder.Value < 4 && !directory.Name.Equals("unlock", StringComparison.OrdinalIgnoreCase)) folders.Push(new KeyValuePair<DirectoryInfo, int>(directory, folder.Value + 1));
                            continue;
                        }
                        string target = entry.Extension.Equals(".ncm", StringComparison.OrdinalIgnoreCase) ? UnlockTarget(entry.FullName) : null;
                        if (target == null) continue;
                        if (Done((FileInfo)entry, target)) skipped++;
                        else if (files.Count >= 1000) { more = true; break; }
                        else files.Add(entry.FullName);
                    }
                }
                files.Sort(StringComparer.OrdinalIgnoreCase);
                return new { id = request.id, files, skipped, more, error = "" };
            } catch (Exception e) { return new { id = request.id, files = new List<string>(), skipped, more, error = e.Message }; }
        }
        // Converted before: a matching receipt, or audio with the same name already in unlock.
        static bool Done(FileInfo file, string target) {
            Receipt receipt;
            if (Receipts.TryGetValue(file.FullName, out receipt) && receipt.signature == Signature(file) && File.Exists(receipt.output)) return true;
            return File.Exists(Path.ChangeExtension(target, ".flac")) || File.Exists(Path.ChangeExtension(target, ".mp3"));
        }
        // Returns true while a search request is listed, so the worker stays until the plugin collects it.
        static bool ServeScan(Control control) {
            if (control.scan == null || String.IsNullOrEmpty(control.scan.id)) { Scan = null; return false; }
            if (control.scan.id != ScanId) {
                ScanId = control.scan.id;
                Report("scanning", "正在查找已有下载", "", false);
                Scan = Find(control.scan);
                Report("ready", "已就绪，等待下载完成", "", false);
            }
            return true;
        }
        static void LoadReceipts() {
            if (!File.Exists(ReceiptPath)) return;
            try { Receipts = new Dictionary<string, Receipt>(Json.Deserialize<Dictionary<string, Receipt>>(File.ReadAllText(ReceiptPath, Utf8)), StringComparer.OrdinalIgnoreCase); }
            catch { Report("warning", "转换记录无法读取，原文件仍被保留。"); return; }
            // A receipt whose output is gone can neither skip nor replace anything.
            var stale = Receipts.Where(p => p.Value == null || !File.Exists(p.Value.output)).Select(p => p.Key).ToList();
            foreach (var key in stale) Receipts.Remove(key);
            if (stale.Count > 0) TryWriteJson(ReceiptPath, Receipts);
        }
        public static int Main(string[] args) {
            ControlPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "control.json");
            bool once = args.Length == 2 && args[0] == "--once";
            if (once) ControlPath = Path.GetFullPath(args[1]);
            StatusPath = Path.Combine(Path.GetDirectoryName(ControlPath), "status.json");
            FileStream singleton = null;
            // An idle worker may still be exiting when the plugin starts the next one; wait briefly for its lock.
            for (int attempt = 0; singleton == null; attempt++) {
                try { singleton = new FileStream(Path.Combine(Path.GetDirectoryName(ControlPath), "worker.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
                catch (IOException) { if (attempt >= 30) return 2; Thread.Sleep(50); }
            }
            using (singleton) {
                try {
                    var initial = Current(); Session = initial.session;
                    if (!once && !Alive(initial)) return 0;
                    Directory.CreateDirectory(initial.state);
                    ReceiptPath = Path.Combine(initial.state, "receipts-v3.json");
                    LoadReceipts();
                    Report("ready", "已就绪，等待下载完成");
                    LastBusy = DateTime.UtcNow;
                    string reason = "插件已关闭";
                    while (true) {
                        Control control;
                        try { control = Current(); } catch { break; }
                        if (!once && !Alive(control)) break;
                        // Unexpected errors here belong to no song: report them without touching the card or the failure count.
                        try { if (ServeScan(control) | Process(control, once)) LastBusy = DateTime.UtcNow; }
                        catch (Exception e) { Report("warning", e.Message); }
                        if (once) break;
                        if (DateTime.UtcNow - LastBusy > IdleLimit(control)) { reason = "空闲，转换程序已退出"; break; }
                        Thread.Sleep(100);
                    }
                    bool mine;
                    try { mine = once || Current().session == Session; } catch { mine = false; }
                    if (mine) Report("stopped", reason, "", false);
                    return Failed > 0 ? 1 : 0;
                } catch (Exception e) { Report("warning", e.Message); return 1; }
            }
        }
    }
    public static class Ncm {
        static byte[] Read(BinaryReader reader, int count) {
            if (count < 0 || count > reader.BaseStream.Length - reader.BaseStream.Position) throw new InvalidDataException("NCM 文件不完整。");
            byte[] data = reader.ReadBytes(count);
            if (data.Length != count) throw new EndOfStreamException();
            return data;
        }
        static byte[] Block(BinaryReader r, int limit) {
            uint size = r.ReadUInt32();
            if (size > limit) throw new InvalidDataException("NCM 数据块长度异常。");
            return Read(r, (int)size);
        }
        static byte[] Aes(byte[] input, string key) {
            using (var aes = System.Security.Cryptography.Aes.Create()) {
                aes.Key = Encoding.ASCII.GetBytes(key); aes.Mode = CipherMode.ECB; aes.Padding = PaddingMode.PKCS7;
                using (var transform = aes.CreateDecryptor()) return transform.TransformFinalBlock(input, 0, input.Length);
            }
        }
        // The song information as JSON bytes; empty when the block is missing or cannot be decrypted.
        static byte[] Meta(byte[] metadata) {
            if (metadata.Length == 0) return new byte[0];
            try {
                for (int i = 0; i < metadata.Length; i++) metadata[i] ^= 0x63;
                string text = Encoding.UTF8.GetString(metadata);
                if (text.StartsWith("163 key(Don't modify):")) {
                    byte[] raw = Aes(Convert.FromBase64String(text.Substring(22)), "#14ljk_!\\]&0U<'(");
                    if (Encoding.UTF8.GetString(raw).StartsWith("music:")) return raw.Skip(6).ToArray();
                }
            } catch (Exception e) { if (!(e is FormatException) && !(e is CryptographicException)) throw; }
            return new byte[0];
        }
        // The song ID from the metadata, read without touching the audio; "" when there is none, as for radio programs.
        public static string MusicId(string source) {
            using (var file = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.None))
            using (var r = new BinaryReader(file)) {
                if (Encoding.ASCII.GetString(Read(r, 8)) != "CTENFDAM") throw new InvalidDataException("不是受支持的 NCM 文件。");
                Read(r, 2);
                Block(r, 1024 * 1024);
                byte[] json = Meta(Block(r, 8 * 1024 * 1024));
                if (json.Length == 0) return "";
                object id;
                try {
                    var info = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(json));
                    if (info == null || !info.TryGetValue("musicId", out id) || id == null) return "";
                } catch (ArgumentException) { return ""; } catch (InvalidOperationException) { return ""; }
                string text = Convert.ToString(id, System.Globalization.CultureInfo.InvariantCulture);
                return text.Length > 0 && text.Length <= 20 && text.All(c => c >= '0' && c <= '9') ? text : "";
            }
        }
        static string Unique(string target) {
            if (!File.Exists(target) && !Directory.Exists(target)) return target;
            string dir = Path.GetDirectoryName(target), stem = Path.GetFileNameWithoutExtension(target), ext = Path.GetExtension(target);
            for (int i = 2; i < 10000; i++) {
                string candidate = Path.Combine(dir, stem + " (" + i + ")" + ext);
                if (!File.Exists(candidate) && !Directory.Exists(candidate)) return candidate;
            }
            throw new IOException("同名文件过多。");
        }
        static void WriteAudio(FileStream file, long start, long length, byte[] mask, string temp, Func<bool> alive, Action<long, long> progress) {
            file.Position = start;
            using (var output = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                byte[] buffer = new byte[64 * 1024]; long offset = 0; int count;
                while ((count = file.Read(buffer, 0, buffer.Length)) > 0) {
                    if (!alive()) throw new OperationCanceledException();
                    for (int i = 0; i < count; i++) buffer[i] ^= mask[(int)((offset + i) & 255)];
                    output.Write(buffer, 0, count); offset += count;
                    if (progress != null) progress(offset, length);
                }
                if (offset != length) throw new IOException("音频读取长度发生变化。");
                output.Flush(true);
            }
        }
        // previous: the receipt of an earlier conversion of the same download; its untouched output is replaced instead of adding "(2)".
        // header: called with the audio format and embedded cover as soon as both are known.
        // lyrics: LRC text to embed with the other tags; empty for none.
        public static Extracted Extract(string source, string target, bool embedMetadata, Func<bool> alive, string expectedSignature = null, Action<long, long> progress = null, Receipt previous = null, Action<string, byte[]> header = null, string lyrics = null) {
            string temp = null;
            try {
                // Exclusive open refuses downloads that are still held open by the client.
                using (var file = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.None))
                using (var r = new BinaryReader(file)) {
                    if (expectedSignature != null && expectedSignature != file.Length + ":" + File.GetLastWriteTimeUtc(source).Ticks) throw new IOException("源文件发生变化，稍后重试。");
                    if (Encoding.ASCII.GetString(Read(r, 8)) != "CTENFDAM") throw new InvalidDataException("不是受支持的 NCM 文件。");
                    Read(r, 2);
                    byte[] encryptedKey = Block(r, 1024 * 1024);
                    for (int i = 0; i < encryptedKey.Length; i++) encryptedKey[i] ^= 0x64;
                    byte[] key = Aes(encryptedKey, "hzHRAmso5kInbaxW");
                    if (key.Length <= 17 || Encoding.ASCII.GetString(key, 0, 17) != "neteasecloudmusic") throw new InvalidDataException("NCM 音频密钥无效。");
                    byte[] box = Enumerable.Range(0, 256).Select(i => (byte)i).ToArray();
                    int j = 0;
                    for (int i = 0; i < 256; i++) { j = (j + box[i] + key[17 + i % (key.Length - 17)]) & 255; byte t = box[i]; box[i] = box[j]; box[j] = t; }
                    byte[] mask = new byte[256];
                    for (int i = 0; i < 256; i++) { int k = (i + 1) & 255; mask[i] = box[(box[k] + box[(box[k] + k) & 255]) & 255]; }
                    byte[] metadata = Block(r, 8 * 1024 * 1024);
                    byte[] plainMeta = Meta(metadata);
                    Read(r, 5); // CRC field and image version; not a reliable audio completeness check.
                    uint coverSpace = r.ReadUInt32(), coverSize = r.ReadUInt32();
                    if (coverSize > coverSpace || coverSpace > 32 * 1024 * 1024 || coverSpace > file.Length - file.Position) throw new InvalidDataException("NCM 封面数据不完整。");
                    byte[] cover = Read(r, (int)coverSize);
                    file.Position += coverSpace - coverSize;
                    long audioLength = file.Length - file.Position;
                    if (audioLength < 4) throw new InvalidDataException("NCM 缺少音频数据。");
                    byte[] head = Read(r, 4);
                    for (int i = 0; i < head.Length; i++) head[i] ^= mask[i];
                    string format;
                    if (Encoding.ASCII.GetString(head) == "fLaC") format = ".flac";
                    else if (Encoding.ASCII.GetString(head, 0, 3) == "ID3" || (head[0] == 255 && (head[1] & 0xe0) == 0xe0 && (head[1] & 6) != 0 && (head[2] & 0xf0) != 0xf0)) format = ".mp3";
                    else throw new InvalidDataException("未识别到 FLAC / MP3 音频，文件可能损坏或格式不受支持。");
                    long audioStart = file.Position - 4;
                    if (header != null) header(format, cover);
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    for (var parent = new DirectoryInfo(Path.GetDirectoryName(target)); parent != null; parent = parent.Parent)
                        if ((parent.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("输出路径包含目录链接。");
                    string natural = Path.ChangeExtension(target, format);
                    bool replace = previous != null && previous.Intact() && Path.GetExtension(previous.output).Equals(format, StringComparison.OrdinalIgnoreCase)
                        && Path.GetDirectoryName(previous.output).Equals(Path.GetDirectoryName(natural), StringComparison.OrdinalIgnoreCase);
                    string dest = replace ? previous.output : Unique(natural);
                    temp = dest + "." + Guid.NewGuid().ToString("N") + ".part";
                    WriteAudio(file, audioStart, audioLength, mask, temp, alive, progress);
                    if (!alive()) throw new OperationCanceledException();
                    var notes = new List<string>();
                    bool withLyrics = false;
                    if (metadata.Length > 0 && plainMeta.Length == 0) notes.Add("歌曲信息无法读取");
                    if (embedMetadata) {
                        try {
                            string note = Metadata.Embed(temp, format, plainMeta, cover, lyrics ?? "", out withLyrics);
                            if (note.Length > 0) notes.Add(note);
                        } catch (Exception) {
                            // Tags are optional: rewrite clean audio instead of losing the song.
                            File.Delete(temp);
                            WriteAudio(file, audioStart, audioLength, mask, temp, alive, null);
                            notes.Clear(); notes.Add("封面与歌曲信息写入失败，已保存原始音频"); withLyrics = false;
                        }
                    }
                    if (!alive()) throw new OperationCanceledException();
                    // Re-check just before committing: the user may have edited the old file meanwhile.
                    if (replace && previous.Intact()) File.Replace(temp, dest, null);
                    else {
                        if (replace) dest = Unique(natural);
                        File.Move(temp, dest);
                    }
                    temp = null;
                    return new Extracted { path = dest, warning = String.Join("；", notes), lyrics = withLyrics };
                }
            } finally { if (temp != null && File.Exists(temp)) File.Delete(temp); }
        }
    }
}
