const fs = require('fs');
const path = require('path');
const os = require('os');
const p = path.join(os.homedir(), 'AppData', 'Roaming', 'airclean-wms-desktop', 'attendanceConfig.json');
const p2 = path.join(os.homedir(), 'AppData', 'Roaming', 'airclean-wms-desktop', 'config.json');

if(fs.existsSync(p)) console.log(`--- ${p} ---\n`, fs.readFileSync(p, 'utf8').substring(0, 500));
if(fs.existsSync(p2)) console.log(`--- ${p2} ---\n`, fs.readFileSync(p2, 'utf8').substring(0, 500));
