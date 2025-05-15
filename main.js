import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import crypto from 'crypto'
import bencode from 'bencode'
import Handlebars from 'handlebars'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 模板文件路径
const TEMPLATES = {
  forumTitle: path.join(__dirname, 'templates/forum-title.hbs'),
  forumContent: path.join(__dirname, 'templates/forum-content.hbs'),
  allianceTitle: path.join(__dirname, 'templates/alliance-title.hbs'),
  allianceContent: path.join(__dirname, 'templates/alliance-content.hbs')
}

// 创建窗口
function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    icon: './assets/icons/icon.png',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      enableRemoteModule: false,
      experimentalFeatures: true,
      nodeIntegrationInWorker: true,
      nodeIntegrationInSubFrames: true,
      webSecurity: false
    }
  })

  mainWindow.loadFile('index.html')

  // 在点击关闭按钮时立即退出程序
  mainWindow.on('close', () => {
    app.quit();
  });
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 处理系统信息请求
ipcMain.handle('get-system-info', async () => {
  return {
    isMacOS: process.platform === 'darwin',
    isWindows: process.platform === 'win32',
    isLinux: process.platform === 'linux'
  }
})

// 递归获取所有文件路径
const getAllFiles = async (filePath) => {
  const stats = await fs.promises.stat(filePath)
  if (stats.isFile()) {
    return [filePath]
  }
  
  const files = []
  const items = await fs.promises.readdir(filePath)
  for (const item of items) {
    // 忽略.DS_Store等系统文件
    if (item.startsWith('.') || item === 'Thumbs.db') {
      continue
    }
    const fullPath = path.join(filePath, item)
    files.push(...await getAllFiles(fullPath))
  }
  return files
}

// 处理文件/文件夹选择
ipcMain.handle('select-files', async () => {
  let properties = ['multiSelections'];
  
  // 根据系统设置不同属性
  if (process.platform === 'darwin') {
    properties.push('openFile', 'openDirectory');
  } else {
    // Windows/Linux系统需要用户选择模式
    const { response } = await dialog.showMessageBox({
      type: 'question',
      buttons: ['选择文件', '选择文件夹', '取消'],
      message: '请选择模式',
      detail: 'Windows/Linux系统不支持同时选择文件和文件夹'
    });
    
    if (response === 0) {
      properties.push('openFile');
    } else if (response === 1) {
      properties.push('openDirectory');
    } else {
      return []; // 用户取消
    }
  }

  const result = await dialog.showOpenDialog({ properties });
  
  const allFiles = []
  for (const filePath of result.filePaths) {
    allFiles.push(...await getAllFiles(filePath))
  }
  
  return allFiles
})

// 处理拖拽文件/文件夹
ipcMain.handle('handle-drop', async (event, filePaths) => {
  const allFiles = []
  for (const filePath of filePaths) {
    allFiles.push(...await getAllFiles(filePath))
  }
  return allFiles
})

// 计算CRC32校验值
function calculateCRC32(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('crc32')
    const stream = fs.createReadStream(filePath)
    
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

// 计算文件总大小
ipcMain.handle('calculateTotalSize', async (event, files) => {
  let totalSize = 0;
  for (const file of files) {
    const stats = await fs.promises.stat(file);
    totalSize += stats.size;
  }
  // Convert to MB with 2 decimal places
  return `${(totalSize / 1024 / 1024).toFixed(2)} MB`;
});

// 生成torrent和magnet链接
ipcMain.handle('createTorrent', async (event, files, pieceLength) => {
  try {
    console.log('Received files:', files);
    console.log('Piece length:', pieceLength);

    if (!files || files.length === 0) {
      throw new Error('No files selected');
    }

    let torrentName;
    if (files.length === 1) {
      const stats = fs.statSync(files[0]);
      if (stats.isDirectory()) {
        torrentName = path.basename(files[0]);
      } else {
        torrentName = path.basename(files[0]);
      }
    } else {
      // 如果选择的是多个文件/文件夹，使用第一个文件的父目录名
      const firstFile = files[0];
      const parentDir = path.dirname(firstFile);
      const parentStats = fs.statSync(parentDir);
      if (parentStats.isDirectory()) {
        torrentName = path.basename(parentDir);
      } else {
        // 如果父目录不是文件夹（不太可能的情况），使用第一个文件名
        torrentName = path.basename(firstFile);
      }
    }

    // Default trackers
    const defaultTrackers = [
      'https://tr.bangumi.moe:9696/announce',
      'http://t.acg.rip:6699/announce',
      'http://tracker.dmhy.org:8000/announce',
      'http://open.acgtracker.com:1096/announce',
      'http://tr.bangumi.moe:6969/announce',
      'http://tracker.lintk.me:2710/announce',
      'http://open.nyaatorrents.info:6544/announce',
      'http://tracker.kuroy.me:5944/announce',
      'http://t.nyaatracker.com/announce',
      'http://nyaa.tracker.wf:7777/announce',
      'http://tracker.kamigami.org:2710/announce',
      'udp://tracker.dmhy.org:8000/announce',
      'udp://tr.bangumi.moe:6969/announce',
      'udp://tracker.skyts.net:6969/announce',
      'http://tracker.skyts.net:6969/announce',
      'https://tracker.ghostchu-services.top/announce',
      'udp://utracker.ghostchu-services.top:6969'
    ];

    const readablePromiseForStream = async function (stream) {
      return new Promise((resolve, _) => {
        stream.on('readable', () => { resolve(); });
      });
    };

    const generatePieces = async function (files) {
      const pieces = [];

      let pieceHashStream = crypto.createHash('sha1');

      // Represents the number of bytes still needed to complete the piece
      // currently being accumulated in pieceHashStream.
      // If 0, pieceHashStream is effectively "empty" or has just been reset
      // after completing a piece.
      let bytesNeededForSpanningPiece = 0;

      let currentFileReadOffset = 0;

      for (let i = 0; i < files.length; ++i) {
        const filePath = files[i];

        if (bytesNeededForSpanningPiece > 0) {
          const headStream = fs.createReadStream(filePath, {
            highWaterMark: pieceLength,
            start: 0,
            end: bytesNeededForSpanningPiece - 1,
          });
          await readablePromiseForStream(headStream);

          let chunkToCompletePiece = headStream.read(bytesNeededForSpanningPiece);
          if (chunkToCompletePiece === null) {
            // If the file is smaller than `bytesNeededForSpanningPiece`,
            // theoretically read again will give back content in buffer.
            // But it doesn't work while debugging (always return null),
            // so fallback to try reading with actual readable length.
            const bytesToRead = Math.min(bytesNeededForSpanningPiece, headStream.readableLength);
            chunkToCompletePiece = headStream.read(bytesToRead);
          }
          headStream.destroy();
          pieceHashStream.update(chunkToCompletePiece);

          if (chunkToCompletePiece.length < bytesNeededForSpanningPiece) {
            bytesNeededForSpanningPiece -= chunkToCompletePiece.length;

            currentFileReadOffset = 0;
            continue;
          } else {
            pieces.push(pieceHashStream.digest());

            pieceHashStream = crypto.createHash('sha1');
            bytesNeededForSpanningPiece = 0;

            currentFileReadOffset = chunkToCompletePiece.length;
          }
        }

        const mainReadStream = fs.createReadStream(files[i], {
          highWaterMark: pieceLength,
          start: currentFileReadOffset,
        });
        currentFileReadOffset = 0;

        for await (const chunk of mainReadStream) {
          if (chunk.length === pieceLength) {
            const hash = crypto.createHash('sha1').update(chunk).digest();
            pieces.push(hash);
          } else {
            pieceHashStream.update(chunk);
            bytesNeededForSpanningPiece = pieceLength - chunk.length;
          }
        }
      }

      if (bytesNeededForSpanningPiece != 0) {
        pieces.push(pieceHashStream.digest());
      }

      return Buffer.concat(pieces);
    };

    const torrent = {
      announce: defaultTrackers[0],
      'announce-list': [defaultTrackers],
      info: {
        'piece length': pieceLength,
        name: torrentName,
        ...(files.length === 1 ? {
          length: fs.statSync(files[0]).size,
          pieces: await generatePieces(files)
        } : {
          files: files.map(file => {
            console.log('Processing file:', file);
            const fileStats = fs.statSync(file);
            if (!fileStats.isFile()) {
              throw new Error(`Path is not a file: ${file}`);
            }
            return {
              path: [path.relative(path.dirname(files[0]), file)],
              length: fileStats.size
            };
          }),
          // Generate pieces
          pieces: await generatePieces(files)
        })
      }
    };

    console.log('Created torrent structure:', torrent);

    // 计算info hash
    const infoBuffer = bencode.encode(torrent.info);
    console.log('Encoded info buffer:', infoBuffer);
    const infoHash = crypto.createHash('sha1').update(infoBuffer).digest('hex');
    console.log('Generated info hash:', infoHash);

    // 生成magnet链接
    const magnetLink = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(torrent.info.name)}&tr=${defaultTrackers.map(encodeURIComponent).join('&tr=')}`;
    console.log('Generated magnet link:', magnetLink);

    // 创建.torrent文件
    const torrentFileName = `${torrent.info.name}.torrent`;
    
    // 显示保存对话框
    const { filePath } = await dialog.showSaveDialog({
      title: '保存种子文件',
      defaultPath: torrentFileName,
      filters: [
        { name: 'Torrent Files', extensions: ['torrent'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (!filePath) {
      throw new Error('保存操作已取消');
    }

    console.log('Writing torrent file to:', filePath);
    await fs.promises.writeFile(filePath, bencode.encode(torrent));
    console.log('Successfully wrote torrent file');

    return {
      infoHash,
      magnetLink,
      torrentFilePath: filePath,
      torrentFileName: path.basename(filePath)
    }
  } catch (error) {
    console.error('Error in createTorrent:', error);
    throw error;
  }
})

// 渲染模板
async function renderTemplate(templatePath, data) {
  const templateContent = await fs.promises.readFile(templatePath, 'utf8')
  const template = Handlebars.compile(templateContent)
  return template(data)
}

// 处理模板生成请求
ipcMain.handle('render-templates', async (event, data) => {
  const results = {}
  
  for (const [key, templatePath] of Object.entries(TEMPLATES)) {
    results[key] = await renderTemplate(templatePath, data)
  }
  
  return results
})
