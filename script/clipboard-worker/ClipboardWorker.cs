// ClipboardWorker：剪贴板文件写入辅助进程（.NET Framework 4.x STA 控制台程序）。
//
// 协议（stdin/stdout 按行）：
//   启动完成后输出 __READY__
//   每行输入 = base64(UTF-8 文件绝对路径)，写入成功输出 __OK__，失败输出 __ERR__<msg>
//   输入 __EXIT__ 或 stdin EOF 时退出
//
// 生命周期由宿主（Electron 主进程）控制：每次复制后由宿主结束本进程，
// 使剪贴板回到「owner 已退出」状态（资源管理器/桌面粘贴可用的前提）。
using System;
using System.Collections.Specialized;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class ClipboardWorker
{
    [DllImport("ole32.dll")]
    private static extern int OleFlushClipboard();

    private static void WriteFileDrop(string filePath)
    {
        var list = new StringCollection { filePath };
        var data = new DataObject();
        data.SetFileDropList(list);

        // 写入后必须回读验证：OleSetClipboard 返回成功不代表数据保留——
        // 剪贴板监听类程序（截图工具/云剪贴板/管理器）可能在毫秒级窗口内用缓存内容覆盖写入。
        // SetDataObject 内部自带 10×100ms 重试，这里再加外层「写入+验证」重试兜底。
        Exception lastError = null;
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            try
            {
                Clipboard.SetDataObject(data, true);
                if (Clipboard.ContainsFileDropList())
                {
                    lastError = null;
                    break;
                }

                lastError = new InvalidOperationException("clipboard verify failed: FileDrop missing after write (attempt " + attempt + ")");
            }
            catch (Exception ex)
            {
                lastError = ex;
            }

            Thread.Sleep(200);
        }

        if (lastError != null)
        {
            throw lastError;
        }

        // best-effort 双保险 flush：SetDataObject(copy=true) 内部已执行 OleFlushClipboard，
        // 二次调用返回 E_FAIL 属预期，忽略返回值；flush 后再回读一次确认数据仍在。
        OleFlushClipboard();
        if (!Clipboard.ContainsFileDropList())
        {
            throw new InvalidOperationException("clipboard verify failed: FileDrop missing after flush");
        }
    }

    private static string DescribeError(Exception ex)
    {
        var message = ex.GetType().Name;
        var external = ex as ExternalException;
        if (external != null)
        {
            message += string.Format(" hr=0x{0:X8}", external.ErrorCode);
        }

        message += ": " + (ex.Message ?? string.Empty);
        return message.Replace('\r', ' ').Replace('\n', ' ');
    }

    [STAThread]
    private static int Main()
    {
        try
        {
            Console.OutputEncoding = Encoding.UTF8;
        }
        catch
        {
            // 输出编码设置失败不影响 ASCII 哨兵协议。
        }

        // 只读不写，预热 WinForms 剪贴板内部懒加载，让首次复制达到毫秒级。
        try
        {
            var warmup = Clipboard.GetDataObject();
        }
        catch
        {
            // 剪贴板被其他进程占用时忽略，真正写入时会重试。
        }

        Console.Out.WriteLine("__READY__");

        string line;
        while ((line = Console.In.ReadLine()) != null)
        {
            if (line == "__EXIT__")
            {
                break;
            }

            try
            {
                var filePath = Encoding.UTF8.GetString(Convert.FromBase64String(line));
                WriteFileDrop(filePath);
                Console.Out.WriteLine("__OK__");
            }
            catch (Exception ex)
            {
                Console.Out.WriteLine("__ERR__" + DescribeError(ex));
            }
        }

        return 0;
    }
}
