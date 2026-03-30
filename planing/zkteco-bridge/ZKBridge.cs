/**
 * ZKBridge.cs — Dung Interop.zkemkeeper.dll truc tiep (khong can COM registration)
 * Build: xem build.bat
 */
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using zkemkeeper;

class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        string ip   = args.Length > 0 ? args[0] : "192.168.0.225";
        int    port = args.Length > 1 ? int.Parse(args[1]) : 4370;
        int    pwd  = args.Length > 2 ? int.Parse(args[2]) : 0;

        string outputPath = Path.Combine(
            AppDomain.CurrentDomain.BaseDirectory,
            "attendance_output.json"
        );

        try
        {
            CZKEM zk = new CZKEM();

            zk.SetCommPassword(pwd);
            Console.WriteLine("[ZKBridge] Connecting " + ip + ":" + port + " (pwd=" + pwd + ")...");
            bool ok = zk.Connect_Net(ip, port);

            if (!ok)
            {
                int errCode = 0;
                zk.GetLastError(ref errCode);
                string msg = "Connection failed. Error code: " + errCode;
                Console.Error.WriteLine("[ZKBridge ERROR] " + msg);
                File.WriteAllText(outputPath,
                    "{\"success\":false,\"error\":\"" + msg + "\",\"logs\":[]}");
                return 2;
            }

            Console.WriteLine("[ZKBridge] Connected! Reading logs...");
            int machineNo = 1;
            zk.ReadGeneralLogData(machineNo);

            var records = new List<string>();
            string sEnrollNumber = "";
            int iVerifyMode = 0, iInOutMode = 0;
            int iYear = 0, iMonth = 0, iDay = 0;
            int iHour = 0, iMinute = 0, iSecond = 0, iWorkCode = 0;

            while (zk.SSR_GetGeneralLogData(
                machineNo,
                out sEnrollNumber,
                out iVerifyMode,
                out iInOutMode,
                out iYear, out iMonth, out iDay,
                out iHour, out iMinute, out iSecond,
                ref iWorkCode))
            {
                string ts = string.Format("{0:0000}-{1:00}-{2:00} {3:00}:{4:00}:{5:00}",
                    iYear, iMonth, iDay, iHour, iMinute, iSecond);
                string shift = iHour < 12 ? "S\u00e1ng" : "Chi\u1ec1u";

                records.Add(string.Format(
                    "{{\"odUserId\":\"{0}\",\"timestamp\":\"{1}\",\"shift\":\"{2}\",\"verifyMode\":{3},\"inOutMode\":{4}}}",
                    sEnrollNumber, ts, shift, iVerifyMode, iInOutMode
                ));
            }

            zk.Disconnect();
            Console.WriteLine("[ZKBridge] Disconnected. Records: " + records.Count);

            var sb = new StringBuilder();
            sb.AppendLine("{");
            sb.AppendLine("  \"success\": true,");
            sb.AppendLine("  \"logCount\": " + records.Count + ",");
            sb.AppendLine("  \"syncTime\": \"" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "\",");
            sb.Append("  \"logs\": [");
            if (records.Count > 0)
            {
                sb.AppendLine();
                sb.AppendLine("    " + string.Join(",\n    ", records));
                sb.Append("  ");
            }
            sb.AppendLine("]");
            sb.AppendLine("}");

            File.WriteAllText(outputPath, sb.ToString(), Encoding.UTF8);
            Console.WriteLine("[ZKBridge] OK -> " + outputPath);
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("[ZKBridge EXCEPTION] " + ex.Message);
            File.WriteAllText(outputPath,
                "{\"success\":false,\"error\":\"" + ex.Message.Replace("\"","'") + "\",\"logs\":[]}");
            return 99;
        }
    }
}
