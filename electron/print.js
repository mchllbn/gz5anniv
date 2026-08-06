const { BrowserWindow } = require('electron');
const fs = require('fs');

/**
 * Silent print pipeline for 2×6" vertical photo strips.
 * Strategy: write PNG → load in hidden BrowserWindow → webContents.print
 * with deviceName, silent:true, and page size matching the strip.
 */

function listPrinters() {
  // Prefer the focused / any existing window's webContents
  const wins = BrowserWindow.getAllWindows();
  if (wins.length === 0) return [];
  try {
    return wins[0].webContents.getPrintersAsync
      ? wins[0].webContents.getPrintersAsync()
      : Promise.resolve(wins[0].webContents.getPrinters());
  } catch {
    return Promise.resolve([]);
  }
}

function inchesFromPixels(px, dpi) {
  return px / dpi;
}

async function printHtmlSilent({
  html,
  printerName,
  copies,
  pageWidthIn,
  pageHeightIn,
  mainWindow,
}) {
  if (!printerName || printerName === 'REPLACE_WITH_WINDOWS_PRINTER_NAME') {
    throw new Error(
      'Printer name is not configured. Open Settings (Ctrl+,) and choose a printer.'
    );
  }

  const printers = await listPrinters();
  const match = printers.find((p) => p.name === printerName);
  if (!match) {
    const names = printers.map((p) => p.name).join(', ') || '(none found)';
    throw new Error(
      `Printer "${printerName}" not found. Installed: ${names}`
    );
  }

  const win = new BrowserWindow({
    show: false,
    width: 600,
    height: 1800,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise((r) => setTimeout(r, 200));

    const printOptions = {
      silent: true,
      printBackground: true,
      deviceName: printerName,
      copies: Math.max(1, Number(copies) || 1),
      margins: { marginType: 'none' },
      landscape: pageWidthIn > pageHeightIn,
      pagesPerSheet: 1,
      collate: false,
      pageSize: {
        width: Math.round(pageWidthIn * 1000) * 1000, // microns: Electron expects microns in some builds
        height: Math.round(pageHeightIn * 1000) * 1000,
      },
    };

    // Electron pageSize custom: width/height in microns
    // 1 inch = 25400 microns
    printOptions.pageSize = {
      width: Math.round(pageWidthIn * 25400),
      height: Math.round(pageHeightIn * 25400),
    };

    const ok = await new Promise((resolve, reject) => {
      win.webContents.print(printOptions, (success, failureReason) => {
        if (success) resolve(true);
        else reject(new Error(failureReason || 'Print failed'));
      });
    });

    if (mainWindow && !mainWindow.isDestroyed()) {
      // no-op; keep main focused
    }

    return { ok, printerName, copies: printOptions.copies };
  } finally {
    if (!win.isDestroyed()) win.close();
  }
}

function stripPrintHtml(dataUrl, pageWidthIn, pageHeightIn) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: ${pageWidthIn}in ${pageHeightIn}in; margin: 0; }
  html, body {
    margin: 0;
    padding: 0;
    width: ${pageWidthIn}in;
    height: ${pageHeightIn}in;
    background: #000;
    overflow: hidden;
  }
  img {
    display: block;
    width: ${pageWidthIn}in;
    height: ${pageHeightIn}in;
    object-fit: fill;
  }
</style>
</head>
<body>
  <img src="${dataUrl}" alt="strip" />
</body>
</html>`;
}

async function printStrip({
  pngBase64,
  printerName,
  copies,
  dpi = 300,
  widthPx,
  heightPx,
  pageWidthIn,
  pageHeightIn,
  mainWindow,
}) {
  const dataUrl = `data:image/png;base64,${pngBase64}`;
  const wIn = inchesFromPixels(widthPx || 600, dpi);
  const hIn = inchesFromPixels(heightPx || 1800, dpi);
  const pw = pageWidthIn ?? (Math.abs(wIn - 2) < 0.05 ? 2 : wIn);
  const ph = pageHeightIn ?? (Math.abs(hIn - 6) < 0.05 ? 6 : hIn);
  return printHtmlSilent({
    html: stripPrintHtml(dataUrl, pw, ph),
    printerName,
    copies,
    pageWidthIn: pw,
    pageHeightIn: ph,
    mainWindow,
  });
}

async function testPrint({
  printerName,
  copies,
  templatePath,
  underfillColor,
  width,
  height,
  dpi,
  mainWindow,
}) {
  let imgSrc = '';
  if (templatePath && fs.existsSync(templatePath)) {
    const buf = fs.readFileSync(templatePath);
    imgSrc = `data:image/png;base64,${buf.toString('base64')}`;
  }

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: 2in 6in; margin: 0; }
  html, body { margin:0; padding:0; width:2in; height:6in; background:${underfillColor || '#1a1408'}; }
  .wrap { position:relative; width:2in; height:6in; }
  img { position:absolute; inset:0; width:100%; height:100%; object-fit:fill; }
  .label {
    position:absolute; left:0; right:0; top:45%;
    text-align:center; color:#d4af37; font-family:Georgia,serif;
    font-size:14px; text-shadow:0 1px 2px #000;
  }
</style>
</head>
<body>
  <div class="wrap">
    ${imgSrc ? `<img src="${imgSrc}" />` : ''}
    <div class="label">TEST PRINT<br/>2×6 Photobooth</div>
  </div>
</body>
</html>`;

  return printHtmlSilent({
    html,
    printerName,
    copies: copies || 1,
    pageWidthIn: 2,
    pageHeightIn: 6,
    mainWindow,
  });
}

module.exports = {
  listPrinters,
  printStrip,
  testPrint,
};
