using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Pipes;
using System.Management.Automation;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program
{
    internal const string Title = "Syntolk — локальные кабинеты";
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr handle, int command);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();

    [STAThread]
    private static void Main()
    {
        bool first;
        using (var single = new Mutex(true, @"Local\SyntolkLocalCabinets", out first))
        {
            if (!first)
            {
                var window = FindWindow(null, Title);
                if (window != IntPtr.Zero) { ShowWindow(window, 9); SetForegroundWindow(window); }
                return;
            }
            SetProcessDPIAware();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new LauncherForm());
        }
    }
}

internal sealed class LauncherForm : Form
{
    private readonly string root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", ".."));
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private readonly Label status = new Label();
    private readonly Button adminButton = new Button();
    private readonly Button partnerButton = new Button();
    private readonly Button retry = new Button();
    private readonly Panel content = new Panel();
    private readonly Label splash = new Label();
    private readonly System.Windows.Forms.Timer phaseTimer = new System.Windows.Forms.Timer();
    private readonly Dictionary<string, object> report = new Dictionary<string, object>();
    private WebView2 adminView;
    private WebView2 partnerView;
    private bool running;
    private string node;
    private string pnpm;

    internal LauncherForm()
    {
        Text = Program.Title;
        Width = 1440; Height = 980;
        MinimumSize = new Size(1000, 680);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(12, 15, 18);
        ForeColor = Color.FromArgb(227, 230, 234);
        Font = new Font("Segoe UI", 10);
        var icon = Path.Combine(root, "apps", "portal", "public", "favicon.ico");
        if (File.Exists(icon)) Icon = new Icon(icon);
        var bar = new Panel { Dock = DockStyle.Top, Height = 52, Padding = new Padding(10, 7, 10, 7), BackColor = Color.FromArgb(22, 25, 29) };
        var controls = new FlowLayoutPanel { Dock = DockStyle.Left, AutoSize = true, WrapContents = false };
        ConfigureButton(adminButton, "Администратор", 168);
        ConfigureButton(partnerButton, "Партнёр", 132);
        adminButton.Enabled = partnerButton.Enabled = false;
        adminButton.Click += delegate { ShowCabinet(adminView, adminButton); };
        partnerButton.Click += delegate { ShowCabinet(partnerView, partnerButton); };
        controls.Controls.Add(adminButton); controls.Controls.Add(partnerButton);
        status.Dock = DockStyle.Right; status.Width = 640; status.TextAlign = ContentAlignment.MiddleRight;
        status.ForeColor = Color.FromArgb(161, 168, 179);
        bar.Controls.Add(status); bar.Controls.Add(controls);
        content.Dock = DockStyle.Fill;
        splash.Dock = DockStyle.Fill; splash.TextAlign = ContentAlignment.MiddleCenter;
        splash.Font = new Font("Segoe UI", 15); splash.Text = "Запуск Syntolk…";
        content.Controls.Add(splash);
        ConfigureButton(retry, "Повторить запуск", 190);
        retry.Dock = DockStyle.Bottom; retry.Height = 46; retry.Visible = false;
        retry.Click += async delegate { await StartAsync(); };
        Controls.Add(content); Controls.Add(retry); Controls.Add(bar);
        phaseTimer.Interval = 400;
        phaseTimer.Tick += delegate {
            try { status.Text = File.ReadAllText(Path.Combine(root, "outputs", "local-launcher", "phase.txt"), Encoding.UTF8); } catch { }
        };
        Shown += async delegate { await StartAsync(); };
        FormClosed += delegate { phaseTimer.Stop(); if (adminView != null) adminView.Dispose(); if (partnerView != null) partnerView.Dispose(); };
    }

    private static void ConfigureButton(Button button, string text, int width)
    {
        button.Text = text; button.Width = width; button.Height = 35;
        button.FlatStyle = FlatStyle.Flat; button.FlatAppearance.BorderSize = 0;
        button.BackColor = Color.FromArgb(34, 38, 43); button.ForeColor = Color.FromArgb(227, 230, 234);
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(51, 55, 61);
        button.Margin = new Padding(0, 0, 7, 0); button.Cursor = Cursors.Hand;
    }

    private void RunScript(string path, Dictionary<string, object> arguments)
    {
        using (var ps = PowerShell.Create())
        {
            ps.AddCommand(path);
            foreach (var argument in arguments) ps.AddParameter(argument.Key, argument.Value);
            ps.Invoke();
            if (ps.HadErrors) throw new InvalidOperationException(ps.Streams.Error[0].ToString());
        }
    }

    private async Task StartAsync()
    {
        if (running) return;
        running = true; report.Clear(); retry.Visible = false; splash.Text = "Запуск Syntolk…"; splash.Visible = true; splash.BringToFront();
        report["ok"] = false; report["state"] = "starting"; report["checkedAt"] = DateTime.UtcNow.ToString("o"); SaveReport();
        adminButton.Enabled = partnerButton.Enabled = false;
        try
        {
            var settings = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "settings.json")));
            node = (string)settings["node"]; pnpm = (string)settings["pnpm"];
            if (!File.Exists(node) || !File.Exists(pnpm)) throw new InvalidOperationException("Не найден Node.js или pnpm. Пересоберите запускатель командой scripts/local-launcher/build.ps1.");
            phaseTimer.Start();
            await Task.Run(() => RunScript(Path.Combine(root, "scripts", "local-launcher", "start-services.ps1"), new Dictionary<string, object> { { "NodePath", node }, { "PnpmPath", pnpm } }));
            var credentials = await ReadCredentialsAsync();
            phaseTimer.Stop(); status.Text = "Открытие кабинетов…";
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(root, ".local-demo", "launcher", "browser-profile"));
            if (adminView == null) adminView = await CreateViewAsync(environment);
            if (partnerView == null) partnerView = await CreateViewAsync(environment);
            var admin = (Dictionary<string, object>)credentials["admin"];
            var partner = (Dictionary<string, object>)credentials["partner"];
            await SignInAsync(adminView, "http://localhost:5673", (string)admin["token"]);
            report["admin"] = await VerifyAsync(adminView, "admin", new[] { "Партнёры", "Программы", "Сообщения", "Тестовые платежи" });
            await CaptureAsync(adminView, "admin.png");
            await SignInAsync(partnerView, "http://127.0.0.1:5673", (string)partner["token"]);
            report["partner"] = await VerifyAsync(partnerView, "partner", new[] { "Локальный партнёр Syntolk", "Калькулятор", "Календарь работ", "Результаты", "Публикации и ссылки" });
            await CaptureAsync(partnerView, "partner.png");
            // Check both again after the second login to catch session replacement.
            report["admin"] = await VerifyAsync(adminView, "admin", new[] { "Партнёры", "Программы", "Сообщения", "Тестовые платежи" });
            report["partner"] = await VerifyAsync(partnerView, "partner", new[] { "Локальный партнёр Syntolk", "Калькулятор", "Календарь работ", "Результаты", "Публикации и ссылки" });
            report["ok"] = true; report["state"] = "ready"; report["checkedAt"] = DateTime.UtcNow.ToString("o");
            SaveReport();
            admin["token"] = null; partner["token"] = null;
            adminButton.Enabled = partnerButton.Enabled = true; splash.Visible = false;
            ShowCabinet(partnerView, partnerButton);
            status.Text = "Оба кабинета открыты · Локальный партнёр Syntolk";
        }
        catch (Exception error)
        {
            phaseTimer.Stop();
            var message = error.Message;
            status.Text = "Не удалось завершить запуск";
            splash.Text = message + "\n\nЖурналы: outputs\\local-launcher";
            splash.Visible = true; splash.BringToFront(); retry.Visible = true;
            report["ok"] = false; report["state"] = "error"; report["error"] = message; report["checkedAt"] = DateTime.UtcNow.ToString("o"); SaveReport();
        }
        finally { running = false; }
    }

    private async Task<Dictionary<string, object>> ReadCredentialsAsync()
    {
        string pipeName = "syntolk-launcher-" + Guid.NewGuid().ToString("N");
        var security = new PipeSecurity();
        security.SetAccessRuleProtection(true, false);
        security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.FullControl, AccessControlType.Allow));
        using (var pipe = new NamedPipeServerStream(pipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 0, 0, security))
        {
            var receive = Task.Run(() => {
                pipe.WaitForConnection();
                using (var reader = new StreamReader(pipe, Encoding.UTF8, false, 4096, true)) return reader.ReadLine();
            });
            await Task.Run(() => {
                using (var ps = PowerShell.Create())
                {
                    ps.AddCommand("Start-Process").AddParameter("FilePath", node)
                        .AddParameter("ArgumentList", new[] { "\"" + Path.Combine(root, "scripts", "local-launcher", "credentials.mjs") + "\"", "--pipe", pipeName })
                        .AddParameter("WorkingDirectory", root).AddParameter("WindowStyle", "Hidden")
                        .AddParameter("RedirectStandardOutput", Path.Combine(root, "outputs", "local-launcher", "auth.stdout.log"))
                        .AddParameter("RedirectStandardError", Path.Combine(root, "outputs", "local-launcher", "auth.stderr.log"));
                    ps.Invoke();
                    if (ps.HadErrors) throw new InvalidOperationException("Не удалось запустить локальную проверку входов.");
                }
            });
            if (await Task.WhenAny(receive, Task.Delay(45000)) != receive) throw new InvalidOperationException("Истекло время проверки локальных входов.");
            var received = await receive;
            if (String.IsNullOrEmpty(received)) throw new InvalidOperationException("Локальная проверка входов закрыла канал без ответа. Подробности в auth.stderr.log.");
            var payload = json.Deserialize<Dictionary<string, object>>(received);
            if (!(bool)payload["ok"]) throw new InvalidOperationException((string)payload["error"]);
            return payload;
        }
    }

    private async Task<WebView2> CreateViewAsync(CoreWebView2Environment environment)
    {
        var view = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(12, 15, 18) };
        content.Controls.Add(view); view.BringToFront();
        await view.EnsureCoreWebView2Async(environment);
        view.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e) {
            e.Handled = true;
            Uri target;
            if (Uri.TryCreate(e.Uri, UriKind.Absolute, out target) && (target.Scheme == "http" || target.Scheme == "https")) Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true });
        };
        return view;
    }

    private async Task NavigateAsync(WebView2 view, string url)
    {
        var done = new TaskCompletionSource<bool>();
        EventHandler<CoreWebView2NavigationCompletedEventArgs> handler = null;
        handler = delegate(object sender, CoreWebView2NavigationCompletedEventArgs e) { if (e.IsSuccess) done.TrySetResult(true); else done.TrySetException(new InvalidOperationException("Не загрузилась локальная страница: " + e.WebErrorStatus)); };
        view.CoreWebView2.NavigationCompleted += handler;
        try
        {
            view.CoreWebView2.Navigate(url);
            if (await Task.WhenAny(done.Task, Task.Delay(30000)) != done.Task) throw new InvalidOperationException("Локальная страница не ответила за 30 секунд.");
            await done.Task;
        }
        finally { view.CoreWebView2.NavigationCompleted -= handler; }
    }

    private async Task SignInAsync(WebView2 view, string origin, string token)
    {
        view.Visible = true; view.BringToFront();
        await NavigateAsync(view, origin + "/");
        var end = DateTime.UtcNow.AddSeconds(30);
        while (DateTime.UtcNow < end)
        {
            if (view.Source.GetLeftPart(UriPartial.Authority) != origin) throw new InvalidOperationException("Вход остановлен: страница перешла на другой адрес.");
            string result = await view.ExecuteScriptAsync("(() => { const text=document.body.innerText; if(location.pathname!='/login' && (text.includes('Выйти'))) return 'ready'; const key=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Ключ администратора / партнёра')); if(key)key.click(); return document.querySelector('input[name=apiKey]')?'input':'wait'; })()");
            if (result == "\"ready\"") return;
            if (result == "\"input\"") break;
            await Task.Delay(150);
        }
        if (view.Source.GetLeftPart(UriPartial.Authority) != origin) throw new InvalidOperationException("Неожиданный адрес страницы входа.");
        string fill = "(() => { if(location.origin!==" + json.Serialize(origin) + ")return false; const input=document.querySelector('input[name=apiKey]'); if(!input)return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input," + json.Serialize(token) + "); input.dispatchEvent(new Event('input',{bubbles:true})); return true; })()";
        if (await view.ExecuteScriptAsync(fill) != "true") throw new InvalidOperationException("Не найдена форма входа по локальному ключу.");
        await Task.Delay(200);
        if (await view.ExecuteScriptAsync("(() => {const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Войти');if(!b||b.disabled)return false;b.click();return true;})()") != "true") throw new InvalidOperationException("Форма входа не готова к отправке.");
        end = DateTime.UtcNow.AddSeconds(30);
        while (DateTime.UtcNow < end)
        {
            if (view.Source.GetLeftPart(UriPartial.Authority) != origin) throw new InvalidOperationException("Страница входа изменила адрес.");
            if (await view.ExecuteScriptAsync("location.pathname!='/login' && document.body.innerText.includes('Выйти')") == "true") return;
            await Task.Delay(200);
        }
        throw new InvalidOperationException("Вход не завершился: кабинет остался на странице входа.");
    }

    private async Task<Dictionary<string, object>> VerifyAsync(WebView2 view, string role, string[] labels)
    {
        if (role == "admin") await view.ExecuteScriptAsync("(() => {const b=[...document.querySelectorAll('button[aria-expanded=false]')].find(b=>b.textContent.trim().toLowerCase()==='администрирование');if(b)b.click();})()");
        var end = DateTime.UtcNow.AddSeconds(20);
        while (DateTime.UtcNow < end)
        {
            string script = "(() => {const labels=" + json.Serialize(labels) + "; return location.pathname!='/login' && labels.every(label=>document.body.innerText.includes(label));})()";
            if (await view.ExecuteScriptAsync(script) == "true") return new Dictionary<string, object> { { "role", role }, { "url", view.Source.AbsoluteUri }, { "labels", labels }, { "verified", true } };
            await Task.Delay(200);
        }
        throw new InvalidOperationException("Кабинет " + role + " не прошёл визуальную проверку разделов.");
    }

    private async Task CaptureAsync(WebView2 view, string file)
    {
        view.Visible = true; view.BringToFront(); await Task.Delay(500);
        using (var stream = File.Create(Path.Combine(root, "outputs", "local-launcher", file))) await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
    }

    private void ShowCabinet(WebView2 view, Button button)
    {
        if (view == null) return;
        view.Visible = true; view.BringToFront();
        adminButton.BackColor = button == adminButton ? Color.FromArgb(63, 67, 74) : Color.FromArgb(34, 38, 43);
        partnerButton.BackColor = button == partnerButton ? Color.FromArgb(63, 67, 74) : Color.FromArgb(34, 38, 43);
    }

    private void SaveReport()
    {
        try { File.WriteAllText(Path.Combine(root, "outputs", "local-launcher", "status.json"), json.Serialize(report), new UTF8Encoding(false)); } catch { }
    }
}
