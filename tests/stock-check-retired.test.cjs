const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const Module = require("node:module");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
function loadWorkCalendar() {
  const { outputText } = ts.transpileModule(read("src/lib/workCalendar.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
  const mod = new Module(path.join(__dirname, "..", "src/lib/workCalendar.cjs"));
  mod.paths = Module._nodeModulePaths(path.join(__dirname, ".."));
  mod._compile(outputText, mod.id);
  return mod.exports;
}

test("daily and Saturday check fines stop on the retired date; earlier days stay", () => {
  const dayjs = require("dayjs");
  const { isPastStockCheckWorkingDay } = loadWorkCalendar();
  const now = dayjs("2026-11-20");
  assert.equal(isPastStockCheckWorkingDay(dayjs("2026-11-02"), now), true);
  assert.equal(isPastStockCheckWorkingDay(dayjs("2026-10-31"), now), true);
  assert.equal(isPastStockCheckWorkingDay(dayjs("2026-11-03"), now), false);
  assert.equal(isPastStockCheckWorkingDay(dayjs("2026-11-07"), now), false);
});

test("the server stops creating daily and full sessions", () => {
  const ipc = read("electron/ipc-handlers.js");
  for (const channel of ["stockCheck:ensureDailySession", "stockCheck:createFullSession"]) {
    const start = ipc.indexOf(`ipcMain.handle("${channel}"`);
    assert.match(ipc.slice(start, start + 300), /STOCK_CHECK_ROUTINE_RETIRED_DATE/);
  }
  const start = ipc.indexOf('ipcMain.handle("stockCheck:getSessions"');
  assert.match(ipc.slice(start, start + 300), /STOCK_CHECK_ROUTINE_RETIRED_DATE/);
});
