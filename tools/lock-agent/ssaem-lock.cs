// 쌤 수업 잠금 프로그램 (학생 PC용).
//
// 하는 일: 127.0.0.1:47800 에서 쌤 수업 화면(브라우저)의 명령을 받아
//   lock   = 화면을 가리고 키보드·마우스를 막는다
//   watch  = 화면은 그대로 두고(선생님 화면을 보게) 키보드·마우스만 막는다. 수업 탭 창을 맨 앞으로 (1.2)
//   unlock = 푼다. 잠금 화면이 포커스를 뺏어 갔으니 잠그기 전 맨 앞 창으로 돌려준다 (1.2)
// 그리고 수업 중 감독용으로 (1.1)
//   GET /activity = 지금 맨 앞 창의 프로그램 이름·창 제목 (카카오톡·유튜브 등 딴짓 확인)
//   GET /shot     = 화면 사진 JPEG (강사 화면의 학생 미리보기)
// 브라우저는 서버에서 강사 명령인지 검증한 뒤에만 여기로 넘긴다. 이 프로그램은 요청의
// Origin이 등록된 쌤 주소인지만 본다 (다른 사이트가 이 PC를 잠그지 못하게).
//
// 자동 업데이트 (1.3): 켤 때와 1시간마다 배포 주소의 ssaem-lock.json(버전·SHA-256)을 보고,
// 새 버전이면 받아서 해시를 맞춰 본 뒤 자기 자신과 바꿔 끼우고 다시 켠다. 잠긴 동안엔 안 한다.
//
// 안전장치: 수업 화면의 살아 있음 신호(/beat)가 90초 끊기면 스스로 푼다
// (네트워크가 죽거나 브라우저가 꺼져 영영 잠기는 일을 막는다).
// 한계: Ctrl+Alt+Del은 윈도우가 막지 못하게 해 둬서 여기서도 못 막는다.
//
// 빌드: build.bat (윈도우에 기본으로 깔린 .NET Framework 4 컴파일러만 쓴다 — C# 5 문법)

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Program
{
    const int Port = 47800;
    const string Version = "1.3";
    const int BeatTimeoutSec = 90;
    const string Home = "https://ssaem-mychat-s-projects.vercel.app";
    const int UpdateEveryMin = 60;

    static readonly HashSet<string> Origins = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        Home,
        "http://localhost:3000",
    };

    static Control ui;
    static NotifyIcon tray;
    static string mode = "none";
    static string message = "";
    static string win = ""; // 수업 탭 창 제목 (브라우저가 document.title을 보낸다)
    static IntPtr before = IntPtr.Zero; // 잠그기 직전 맨 앞 창
    static DateTime lastBeat = DateTime.UtcNow;
    static readonly List<Form> covers = new List<Form>();
    static bool restart; // 업데이트로 바꿔 끼웠으면 끝날 때 새 exe를 띄운다

    [STAThread]
    static void Main(string[] args)
    {
        bool fresh;
        using (var mutex = new Mutex(true, "ssaem-lock-agent", out fresh))
        {
            // 업데이트 직후엔 이전 프로세스가 끝나기를 잠깐 기다린다
            if (!fresh && args.Length > 0 && args[0] == "--updated")
            {
                try { fresh = mutex.WaitOne(15000); }
                catch (AbandonedMutexException) { fresh = true; }
            }
            if (!fresh) return; // 이미 실행 중

            SetProcessDPIAware();
            try { File.Delete(Application.ExecutablePath + ".old"); } catch { }
            LoadOrigins();
            RegisterAutostart();

            Application.EnableVisualStyles();
            ui = new Control();
            ui.CreateControl(); // UI 스레드 핸들 — 서버 스레드가 이걸로 Invoke 한다
            var h = ui.Handle;

            tray = new NotifyIcon { Icon = SystemIcons.Shield, Visible = true, Text = "쌤 수업 잠금 - 대기 중" };

            var timer = new System.Windows.Forms.Timer { Interval = 1000 };
            timer.Tick += delegate { Tick(); };
            timer.Start();

            var server = new Thread(Serve) { IsBackground = true };
            server.Start();

            var updater = new Thread(UpdateLoop) { IsBackground = true };
            updater.Start();

            Application.Run();
            tray.Visible = false;
            tray.Dispose();
            if (restart) mutex.ReleaseMutex();
        }
        if (restart)
        {
            try { Process.Start(Application.ExecutablePath, "--updated"); } catch { }
        }
    }

    // ───────── 자동 업데이트 ─────────

    static void UpdateLoop()
    {
        Thread.Sleep(20000); // 로그인 직후 네트워크가 잡힐 때까지
        while (true)
        {
            try { CheckUpdate(); } catch { }
            Thread.Sleep(UpdateEveryMin * 60 * 1000);
        }
    }

    static void CheckUpdate()
    {
        if (mode != "none") return; // 잠긴 학생 PC를 업데이트로 풀어 버리지 않게
        ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2 (.NET 4 기본값은 TLS 1.0이라 Vercel이 거절)
        string json;
        using (var wc = new WebClient())
        {
            wc.Encoding = Encoding.UTF8;
            json = wc.DownloadString(Home + "/downloads/ssaem-lock.json?t=" + DateTime.UtcNow.Ticks);
        }
        var v = Field(json, "v");
        var hash = Field(json, "sha256").ToLowerInvariant();
        System.Version next;
        if (!System.Version.TryParse(v, out next) || next <= new System.Version(Version) || hash.Length != 64) return;

        byte[] exe;
        using (var wc = new WebClient())
            exe = wc.DownloadData(Home + "/downloads/ssaem-lock.exe?v=" + v);
        string got;
        using (var sha = SHA256.Create())
            got = BitConverter.ToString(sha.ComputeHash(exe)).Replace("-", "").ToLowerInvariant();
        if (got != hash) return; // 덜 받았거나 배포가 반쯤 바뀐 중 — 다음에 다시

        // 실행 중인 exe는 덮어쓸 수 없지만 이름은 바꿀 수 있다 → 옛 것은 .old로 비키고 새 것을 그 자리에
        var path = Application.ExecutablePath;
        File.WriteAllBytes(path + ".new", exe);
        File.Delete(path + ".old");
        File.Move(path, path + ".old");
        try { File.Move(path + ".new", path); }
        catch
        {
            File.Move(path + ".old", path); // 되돌리기
            throw;
        }
        ui.BeginInvoke((MethodInvoker)delegate
        {
            if (mode != "none") return; // 받는 사이 잠겼으면 다음 실행 때 새 버전으로
            restart = true;
            Application.Exit();
        });
    }

    // ───────── 설정 ─────────

    // 같은 폴더의 ssaem-lock.ini 에 "origin=https://..." 줄을 넣으면 그 주소도 허용한다
    // (학원 전용 도메인을 붙였을 때).
    static void LoadOrigins()
    {
        try
        {
            var ini = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ssaem-lock.ini");
            if (!File.Exists(ini)) return;
            foreach (var line in File.ReadAllLines(ini))
            {
                var t = line.Trim();
                if (t.StartsWith("origin=", StringComparison.OrdinalIgnoreCase))
                    Origins.Add(t.Substring(7).Trim().TrimEnd('/'));
            }
        }
        catch { }
    }

    // 로그인할 때마다 자동 실행 (현재 사용자 기준 — 관리자 권한 불필요)
    static void RegisterAutostart()
    {
        try
        {
            using (var k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                if (k != null) k.SetValue("ssaem-lock", "\"" + Application.ExecutablePath + "\"");
        }
        catch { }
    }

    // ───────── 잠금 상태 (UI 스레드에서만 바꾼다) ─────────

    static void Apply(string next, string text, string title)
    {
        message = text;
        if (title != "") win = title;
        if (next == mode && next != "lock") return;
        var prev = mode;
        if (prev == "none") before = GetForegroundWindow();
        mode = next;
        ClearCovers();
        if (mode == "lock")
            foreach (var s in Screen.AllScreens) covers.Add(Cover(s.Bounds, false));
        else if (mode == "watch")
            covers.Add(Cover(Banner(Screen.PrimaryScreen.Bounds), true));
        foreach (var f in covers) f.Show();
        Hooks(mode != "none");
        tray.Text = mode == "lock" ? "쌤 수업 잠금 - 잠김" : mode == "watch" ? "쌤 수업 잠금 - 화면 보기" : "쌤 수업 잠금 - 대기 중";
        // 보기: 선생님 화면은 수업 탭이 띄운다 — 그 창이 맨 앞이어야 보인다 (못 찾으면 잠그기 전 창).
        // 잠금 → 해제: 잠금 화면이 1초마다 포커스를 뺏었다. 안 돌려주면 브라우저가 포커스 없이 남아
        // 강사 화면에 "수업 탭 떠남"이 계속 뜬다.
        if (mode == "watch")
        {
            var w = FindByTitle(win);
            Front(w != IntPtr.Zero ? w : before);
        }
        else if (mode == "none" && prev == "lock") Front(before);
    }

    // 다른 프로그램이 맨 앞일 땐 SetForegroundWindow가 막힌다 — 맨 앞 창의 입력 큐에 잠깐 붙어서 넘긴다
    static void Front(IntPtr h)
    {
        if (h == IntPtr.Zero || !IsWindow(h)) return;
        if (IsIconic(h)) ShowWindow(h, 9 /*SW_RESTORE*/);
        int pid;
        uint fg = GetWindowThreadProcessId(GetForegroundWindow(), out pid), me = GetCurrentThreadId();
        bool attached = fg != 0 && fg != me && AttachThreadInput(me, fg, true);
        BringWindowToTop(h);
        SetForegroundWindow(h);
        if (attached) AttachThreadInput(me, fg, false);
    }

    // 제목이 title로 시작하는 보이는 창 중 맨 위 것 (브라우저 창 제목 = "탭 제목 - … - Microsoft Edge")
    static IntPtr FindByTitle(string title)
    {
        if (string.IsNullOrEmpty(title)) return IntPtr.Zero;
        var found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr h, IntPtr l)
        {
            if (!IsWindowVisible(h)) return true;
            var sb = new StringBuilder(512);
            GetWindowText(h, sb, sb.Capacity);
            if (!sb.ToString().StartsWith(title, StringComparison.Ordinal)) return true;
            found = h;
            return false;
        }, IntPtr.Zero);
        return found;
    }

    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc fn, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

    static void Tick()
    {
        if (mode == "none") return;
        if ((DateTime.UtcNow - lastBeat).TotalSeconds > BeatTimeoutSec)
        {
            Apply("none", "", "");
            return;
        }
        // 다른 창이 위로 올라오지 못하게 계속 맨 위로
        foreach (var f in covers)
        {
            f.TopMost = true;
            if (mode == "lock") f.Activate();
        }
    }

    static Rectangle Banner(Rectangle screen)
    {
        int w = Math.Min(560, screen.Width - 40), hgt = 52;
        return new Rectangle(screen.Left + (screen.Width - w) / 2, screen.Top + 12, w, hgt);
    }

    static Form Cover(Rectangle bounds, bool banner)
    {
        var f = banner ? new BannerForm() : new Form();
        f.FormBorderStyle = FormBorderStyle.None;
        f.StartPosition = FormStartPosition.Manual;
        f.Bounds = bounds;
        f.TopMost = true;
        f.ShowInTaskbar = false;
        f.BackColor = Color.FromArgb(30, 58, 95);
        var label = new Label
        {
            Dock = DockStyle.Fill,
            ForeColor = Color.White,
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font("Malgun Gothic", banner ? 13f : 30f, FontStyle.Bold),
            Text = banner
                ? "선생님 화면 보기 중 · 키보드와 마우스가 잠겼어요"
                : (string.IsNullOrEmpty(message) ? "선생님이 화면을 잠갔어요" : message) + "\n\n잠시 선생님을 봐 주세요",
        };
        f.Controls.Add(label);
        f.FormClosing += delegate(object s, FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing && mode != "none") e.Cancel = true; // Alt+F4 무시
        };
        return f;
    }

    static void ClearCovers()
    {
        var old = covers.ToArray();
        covers.Clear();
        foreach (var f in old) { f.Hide(); f.Dispose(); }
    }

    // 클릭을 통과시키고 포커스를 뺏지 않는 상단 안내 띠 (보기 모드)
    class BannerForm : Form
    {
        protected override bool ShowWithoutActivation { get { return true; } }
        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= 0x08000000 /*NOACTIVATE*/ | 0x00000020 /*TRANSPARENT*/ | 0x00000080 /*TOOLWINDOW*/;
                return cp;
            }
        }
    }

    // ───────── 키보드·마우스 훅 ─────────

    delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
    static HookProc kbProc = KbHook, msProc = MsHook; // GC가 치우지 않게 필드로 잡아둔다
    static IntPtr kbHook = IntPtr.Zero, msHook = IntPtr.Zero;

    static void Hooks(bool on)
    {
        if (on && kbHook == IntPtr.Zero)
        {
            var mod = GetModuleHandle(null);
            kbHook = SetWindowsHookEx(13 /*WH_KEYBOARD_LL*/, kbProc, mod, 0);
            msHook = SetWindowsHookEx(14 /*WH_MOUSE_LL*/, msProc, mod, 0);
        }
        else if (!on && kbHook != IntPtr.Zero)
        {
            UnhookWindowsHookEx(kbHook);
            UnhookWindowsHookEx(msHook);
            kbHook = msHook = IntPtr.Zero;
        }
    }

    static IntPtr KbHook(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0 && mode != "none") return (IntPtr)1; // 모든 키 차단 (Win·Alt+Tab 포함)
        return CallNextHookEx(kbHook, code, wParam, lParam);
    }

    static IntPtr MsHook(int code, IntPtr wParam, IntPtr lParam)
    {
        // 포인터 이동만 허용, 클릭·휠은 차단
        if (code >= 0 && mode != "none" && (int)wParam != 0x0200 /*WM_MOUSEMOVE*/) return (IntPtr)1;
        return CallNextHookEx(msHook, code, wParam, lParam);
    }

    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc fn, IntPtr mod, uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    // ───────── 로컬 HTTP 서버 ─────────

    static void Serve()
    {
        TcpListener listener = null;
        // 업데이트로 다시 켜질 땐 이전 프로세스가 포트를 놓을 때까지 조금 걸린다
        for (int i = 0; listener == null; i++)
        {
            try
            {
                listener = new TcpListener(IPAddress.Loopback, Port);
                listener.Start();
            }
            catch
            {
                listener = null;
                if (i >= 20)
                {
                    ui.BeginInvoke((MethodInvoker)delegate { tray.Text = "쌤 수업 잠금 - 포트 사용 중"; });
                    return;
                }
                Thread.Sleep(500);
            }
        }
        while (true)
        {
            try
            {
                var c = listener.AcceptTcpClient();
                ThreadPool.QueueUserWorkItem(delegate { Handle(c); });
            }
            catch { Thread.Sleep(200); }
        }
    }

    static void Handle(TcpClient c)
    {
        using (c)
        {
            try
            {
                c.ReceiveTimeout = 3000;
                var s = c.GetStream();
                string head, body;
                if (!ReadRequest(s, out head, out body)) return;

                var lines = head.Split(new[] { "\r\n" }, StringSplitOptions.None);
                var parts = lines[0].Split(' ');
                if (parts.Length < 2) return;
                string method = parts[0], path = parts[1];
                string origin = null;
                foreach (var l in lines)
                    if (l.StartsWith("Origin:", StringComparison.OrdinalIgnoreCase)) origin = l.Substring(7).Trim();

                // 브라우저 요청이면 Origin이 붙는다 — 등록된 쌤 주소만 받는다
                if (origin != null && !Origins.Contains(origin.TrimEnd('/')))
                {
                    Respond(s, 403, null, "{\"ok\":false}");
                    return;
                }

                if (method == "OPTIONS")
                {
                    Respond(s, 204, origin, null);
                    return;
                }

                string query = "";
                int qi = path.IndexOf('?');
                if (qi >= 0) { query = path.Substring(qi + 1); path = path.Substring(0, qi); }

                // 화면·창 제목은 쌤 수업 화면(등록된 Origin)에만 준다.
                // <img src=…>처럼 Origin 없이 오는 요청은 다른 사이트일 수 있어 거절.
                if (method == "GET" && (path == "/activity" || path == "/shot"))
                {
                    if (origin == null)
                    {
                        Respond(s, 403, null, "{\"ok\":false}");
                        return;
                    }
                    if (path == "/activity")
                        Respond(s, 200, origin, Activity());
                    else
                        RespondBytes(s, 200, origin, Shot(QueryInt(query, "w", 480, 160, 1920), QueryInt(query, "q", 60, 20, 90)), "image/jpeg");
                    return;
                }

                if (method == "POST" && path == "/cmd")
                {
                    var action = Field(body, "action");
                    var text = Field(body, "text");
                    var title = Field(body, "win");
                    if (action == "lock" || action == "watch" || action == "unlock")
                    {
                        var next = action == "unlock" ? "none" : action;
                        lastBeat = DateTime.UtcNow;
                        ui.Invoke((MethodInvoker)delegate { Apply(next, text, title); });
                    }
                }
                else if (method == "POST" && path == "/beat")
                {
                    lastBeat = DateTime.UtcNow;
                }
                else if (!(method == "GET" && path == "/status"))
                {
                    Respond(s, 404, origin, "{\"ok\":false}");
                    return;
                }
                Respond(s, 200, origin, "{\"ok\":true,\"v\":\"" + Version + "\",\"mode\":\"" + mode + "\"}");
            }
            catch { }
        }
    }

    static bool ReadRequest(NetworkStream s, out string head, out string body)
    {
        head = body = "";
        var buf = new MemoryStream();
        var one = new byte[4096];
        int end = -1;
        while (end < 0)
        {
            int n = s.Read(one, 0, one.Length);
            if (n <= 0) return false;
            buf.Write(one, 0, n);
            if (buf.Length > 65536) return false;
            end = IndexOf(buf.GetBuffer(), (int)buf.Length, new byte[] { 13, 10, 13, 10 });
        }
        var all = buf.ToArray();
        head = Encoding.ASCII.GetString(all, 0, end);
        var m = Regex.Match(head, @"Content-Length:\s*(\d+)", RegexOptions.IgnoreCase);
        int len = m.Success ? Math.Min(int.Parse(m.Groups[1].Value), 16384) : 0;
        var rest = new MemoryStream();
        rest.Write(all, end + 4, all.Length - end - 4);
        while (rest.Length < len)
        {
            int n = s.Read(one, 0, one.Length);
            if (n <= 0) break;
            rest.Write(one, 0, n);
        }
        body = Encoding.UTF8.GetString(rest.ToArray(), 0, (int)Math.Min(rest.Length, len));
        return true;
    }

    static int IndexOf(byte[] hay, int len, byte[] needle)
    {
        for (int i = 0; i + needle.Length <= len; i++)
        {
            int j = 0;
            while (j < needle.Length && hay[i + j] == needle[j]) j++;
            if (j == needle.Length) return i;
        }
        return -1;
    }

    // {"action":"lock","text":"..."} 에서 문자열 값 하나 꺼내기 (JSON 라이브러리 없이)
    static string Field(string json, string name)
    {
        var m = Regex.Match(json, "\"" + name + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
        if (!m.Success) return "";
        return Regex.Unescape(m.Groups[1].Value);
    }

    // ───────── 감독: 맨 앞 창 · 화면 사진 ─────────

    static string Activity()
    {
        var h = GetForegroundWindow();
        var title = new StringBuilder(512);
        GetWindowText(h, title, title.Capacity);
        int pid;
        GetWindowThreadProcessId(h, out pid);
        string app = "";
        try { if (pid != 0) app = Process.GetProcessById(pid).ProcessName; } catch { }
        return "{\"ok\":true,\"app\":\"" + Esc(app) + "\",\"title\":\"" + Esc(title.ToString()) + "\"}";
    }

    static byte[] Shot(int w, int q)
    {
        var vs = SystemInformation.VirtualScreen; // 모니터 여러 대면 전부
        using (var full = new Bitmap(vs.Width, vs.Height))
        {
            using (var g = Graphics.FromImage(full))
                g.CopyFromScreen(vs.Left, vs.Top, 0, 0, vs.Size);
            int h = Math.Max(1, (int)((long)vs.Height * w / vs.Width));
            using (var small = new Bitmap(w, h))
            {
                using (var g = Graphics.FromImage(small))
                {
                    g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear;
                    g.DrawImage(full, 0, 0, w, h);
                }
                System.Drawing.Imaging.ImageCodecInfo jpeg = null;
                foreach (var c in System.Drawing.Imaging.ImageCodecInfo.GetImageEncoders())
                    if (c.MimeType == "image/jpeg") jpeg = c;
                var ps = new System.Drawing.Imaging.EncoderParameters(1);
                ps.Param[0] = new System.Drawing.Imaging.EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)q);
                using (var ms = new MemoryStream())
                {
                    small.Save(ms, jpeg, ps);
                    return ms.ToArray();
                }
            }
        }
    }

    static int QueryInt(string query, string name, int def, int min, int max)
    {
        var m = Regex.Match("&" + query, "&" + name + "=(\\d+)");
        int v;
        if (!m.Success || !int.TryParse(m.Groups[1].Value, out v)) return def;
        return Math.Max(min, Math.Min(max, v));
    }

    static string Esc(string v)
    {
        var sb = new StringBuilder();
        foreach (var ch in v)
        {
            if (ch == '"' || ch == '\\') sb.Append('\\').Append(ch);
            else if (ch < 0x20) sb.Append("\\u").Append(((int)ch).ToString("x4"));
            else sb.Append(ch);
        }
        return sb.ToString();
    }

    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder text, int max);

    static void Respond(NetworkStream s, int code, string origin, string json)
    {
        RespondBytes(s, code, origin, json == null ? null : Encoding.UTF8.GetBytes(json), "application/json");
    }

    static void RespondBytes(NetworkStream s, int code, string origin, byte[] body, string type)
    {
        var sb = new StringBuilder();
        sb.Append("HTTP/1.1 ").Append(code).Append(code == 200 ? " OK" : code == 204 ? " No Content" : " Error").Append("\r\n");
        if (origin != null)
        {
            sb.Append("Access-Control-Allow-Origin: ").Append(origin).Append("\r\n");
            sb.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
            sb.Append("Access-Control-Allow-Headers: Content-Type\r\n");
            sb.Append("Access-Control-Allow-Private-Network: true\r\n");
            sb.Append("Vary: Origin\r\n");
        }
        var bytes = body ?? new byte[0];
        if (body != null) sb.Append("Content-Type: ").Append(type).Append("\r\n");
        sb.Append("Cache-Control: no-store\r\nConnection: close\r\nContent-Length: ").Append(bytes.Length).Append("\r\n\r\n");
        var h = Encoding.ASCII.GetBytes(sb.ToString());
        s.Write(h, 0, h.Length);
        s.Write(bytes, 0, bytes.Length);
    }
}
