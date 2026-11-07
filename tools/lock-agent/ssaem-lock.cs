// 쌤 수업 잠금 프로그램 (학생 PC용).
//
// 하는 일: 127.0.0.1:47800 에서 쌤 수업 화면(브라우저)의 명령을 받아
//   lock   = 화면을 가리고 키보드·마우스를 막는다
//   watch  = 화면은 그대로 두고(선생님 화면을 보게) 키보드·마우스만 막는다
//   unlock = 푼다
// 브라우저는 서버에서 강사 명령인지 검증한 뒤에만 여기로 넘긴다. 이 프로그램은 요청의
// Origin이 등록된 쌤 주소인지만 본다 (다른 사이트가 이 PC를 잠그지 못하게).
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
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Program
{
    const int Port = 47800;
    const string Version = "1.0";
    const int BeatTimeoutSec = 90;

    static readonly HashSet<string> Origins = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "https://ssaem-mychat-s-projects.vercel.app",
        "http://localhost:3000",
    };

    static Control ui;
    static NotifyIcon tray;
    static string mode = "none";
    static string message = "";
    static DateTime lastBeat = DateTime.UtcNow;
    static readonly List<Form> covers = new List<Form>();

    [STAThread]
    static void Main()
    {
        bool fresh;
        using (var mutex = new Mutex(true, "ssaem-lock-agent", out fresh))
        {
            if (!fresh) return; // 이미 실행 중

            SetProcessDPIAware();
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

            Application.Run();
            tray.Visible = false;
        }
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

    static void Apply(string next, string text)
    {
        message = text;
        if (next == mode && next != "lock") return;
        mode = next;
        ClearCovers();
        if (mode == "lock")
            foreach (var s in Screen.AllScreens) covers.Add(Cover(s.Bounds, false));
        else if (mode == "watch")
            covers.Add(Cover(Banner(Screen.PrimaryScreen.Bounds), true));
        foreach (var f in covers) f.Show();
        Hooks(mode != "none");
        tray.Text = mode == "lock" ? "쌤 수업 잠금 - 잠김" : mode == "watch" ? "쌤 수업 잠금 - 화면 보기" : "쌤 수업 잠금 - 대기 중";
    }

    static void Tick()
    {
        if (mode == "none") return;
        if ((DateTime.UtcNow - lastBeat).TotalSeconds > BeatTimeoutSec)
        {
            Apply("none", "");
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
        TcpListener listener;
        try
        {
            listener = new TcpListener(IPAddress.Loopback, Port);
            listener.Start();
        }
        catch
        {
            ui.BeginInvoke((MethodInvoker)delegate { tray.Text = "쌤 수업 잠금 - 포트 사용 중"; });
            return;
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

                if (method == "POST" && path == "/cmd")
                {
                    var action = Field(body, "action");
                    var text = Field(body, "text");
                    if (action == "lock" || action == "watch" || action == "unlock")
                    {
                        var next = action == "unlock" ? "none" : action;
                        lastBeat = DateTime.UtcNow;
                        ui.Invoke((MethodInvoker)delegate { Apply(next, text); });
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

    static void Respond(NetworkStream s, int code, string origin, string json)
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
        var bytes = json == null ? new byte[0] : Encoding.UTF8.GetBytes(json);
        if (json != null) sb.Append("Content-Type: application/json\r\n");
        sb.Append("Cache-Control: no-store\r\nConnection: close\r\nContent-Length: ").Append(bytes.Length).Append("\r\n\r\n");
        var h = Encoding.ASCII.GetBytes(sb.ToString());
        s.Write(h, 0, h.Length);
        s.Write(bytes, 0, bytes.Length);
    }
}
