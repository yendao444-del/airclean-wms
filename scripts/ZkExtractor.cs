using System;
using System.Threading;

namespace ZkFetch {
    class Program {
        [STAThread]
        static int Main(string[] args) {
            try {
                Type zkemType = Type.GetTypeFromProgID("zkemkeeper.ZKEM");
                if (zkemType == null) {
                    Console.WriteLine("{\"success\": false, \"error\": \"zkemkeeper dll not installed\"}");
                    return 1;
                }
                dynamic zk = Activator.CreateInstance(zkemType);
                
                string ip = args.Length > 0 ? args[0] : "192.168.1.225";
                int port = args.Length > 1 ? int.Parse(args[1]) : 5005;

                bool connected = zk.Connect_Net(ip, port);
                if (!connected) {
                    int errorCode = 0;
                    zk.GetLastError(ref errorCode);
                    Console.WriteLine("{\"success\": false, \"error\": \"Connection failed. Error code: " + errorCode + "\"}");
                    return 1;
                }
                
                // If connected, grab logs
                Console.WriteLine("{\"success\": true, \"message\": \"Connected!\"}");
                zk.Disconnect();
                return 0;
            } catch (Exception ex) {
                 Console.WriteLine("{\"success\": false, \"error\": \"" + ex.Message.Replace("\"", "\\\"") + "\"}");
                 return 1;
            }
        }
    }
}
