![FreeGIF Logo](Assets/logo_with_text.png)

A free GIF screen recorder and editor based on Electron.

demo:https://www.bilibili.com/video/BV1bU43zYE7m

English | [简体中文](README.md)

## ✨ Features

- 📹 **Screen Recording** - Select any area to record with multiple frame rate options (5-30 FPS)
- 🎬 **Real-time Preview** - Preview before recording and view content during recording
- ✂️ **Frame Trimming** - Precisely trim start and end frames of GIF
- ⚙️ **Playback Control** - Support play/pause, frame-by-frame navigation, speed adjustment (0.5x-2x)
- 🎨 **Quality Control** - Multiple quality presets with custom dithering, palette, and resolution
- 📁 **Import & Edit** - Import existing GIF files for re-editing
- 💾 **Quick Export** - One-click export with real-time encoding progress
- 🎯 **Unified Interface** - Recording and editing in one window
- 🔄 **Lazy Loading** - Load frames on-demand, enter edit mode instantly
- 📊 **File Size Estimation** - Real-time preview of export file size

## 📦 Download & Installation

### Method 1: Download Pre-built Version (Recommended)

- **Windows**:https://github.com/zstar1003/FreeGIF/releases/download/v1.0.0/FreeGIF.Setup.1.0.0.exe


### Method 2: Run from Source

```bash
# Clone the project
git clone https://github.com/zstar1003/FreeGIF.git
cd FreeGIF

# Install dependencies
npm install

# Start the application
npm start
```

### Method 3: Build Locally

```bash
# Install dependencies
npm install

# Build for Windows
npm run build:win

# Build for macOS
npm run build:mac

# Build for all platforms
npm run build
```

Build artifacts will be output to the `dist` directory.

## 🎮 Usage

### Recording GIF

1. Launch the app and click the **"📹 Start Recording"** button
2. Drag to select the area you want to record
3. Choose frame rate (5-30 FPS, default 10 FPS)
4. Click **"Start Recording"** to begin (with live preview)
5. Click **"Stop Recording"** to finish
6. Automatically switch to edit mode

### Editing GIF

After recording, automatically enter edit mode:

#### Playback Controls

- **Play/Pause** - Preview GIF effect
- **Previous/Next Frame** - Navigate frame by frame
- **Speed Control** - 0.5x, 1x, 2x playback speed
- **Loop Playback** - Toggle loop mode
- **Timeline** - Click frame numbers to jump quickly

#### Editing Functions

- **Trim Frames** - Set start and end frames, remove unwanted parts
- **Quality Presets** - High Quality, Standard Quality, Compression Priority
- **Advanced Settings**:
  - Output Resolution (25%-100%)
  - Color Sampling Quality (1%-100%)
  - Dithering (Off/Simplified/Floyd-Steinberg/Stucki/Atkinson)
  - Palette Mode (Local/Global)

#### Information Display

- Current Frame / Total Frames
- Screen Resolution
- Estimated File Size

### Import GIF

1. Click the **"📁 Import GIF"** button
2. Select a local GIF file
3. Wait for parsing to complete, enter edit mode

### Export GIF

1. After editing, click the **"💾 Export GIF"** button
2. Choose save location and filename
3. Wait for encoding to complete (shows real-time progress)
4. Export success notification

## 📂 Project Structure

```
FreeGIF/
├── .github/
│   └── workflows/
│       ├── build.yml           # GitHub Actions CI/CD config
│       └── README.md           # CI/CD documentation
├── Assets/                     # Resource files
│   └── logo.png
├── src/
│   ├── main.js                 # Electron main process
│   ├── public/
│   │   └── logo.ico            # App icon
│   └── renderer/               # Renderer process
│       ├── recorder.html       # Main interface (recording + editing)
│       ├── recorder.js         # Recording and editing logic
│       ├── selector.html       # Area selection interface
│       └── selector.js         # Area selection logic
├── package.json                # Project config and dependencies
├── CHANGELOG.md                # Changelog
├── README.md                   # Chinese documentation
└── README_EN.md                # English documentation
```

## 🛠 Tech Stack

- **Electron** `^28.0.0` - Cross-platform desktop app framework
- **gif.js** `^0.2.0` - Pure JavaScript GIF encoder
- **omggif** `^1.0.10` - GIF decoder and parser
- **@electron/remote** `^2.1.2` - Remote module support
- **electron-builder** `^24.9.1` - App packaging tool
- **Canvas API** - Image processing and frame extraction
- **MediaRecorder API** - Screen recording

## 💡 Usage Tips

### Recording Tips

- **Duration**: Recommended 10-30 seconds
- **Recording Area**: Works best under 800x600
- **Frame Rate Selection**:
  - 5-10 FPS: For static content, tutorials
  - 15-20 FPS: For general animations, operation demos
  - 25-30 FPS: For smooth animations, game recording

### Optimization Tips

- **Quality Presets**:
  - High Quality: For saving and sharing high-quality content
  - Standard Quality (Recommended): Balance between quality and size
  - Compression Priority: For quick sharing and network transmission
- **Resolution Scaling**: 75% significantly reduces file size while maintaining clarity
- **Dithering**: Floyd-Steinberg works well for most scenarios
- **Palette**: Local palette offers better quality, global palette produces smaller files

## ⚠️ Notes

1. **Permissions**: First run requires screen recording permission (Windows/macOS)
2. **Memory Usage**: Recording large areas or long duration consumes more memory
3. **Export Time**: Depends on frame count, resolution, and quality settings
4. **Frame Limit**: Frame limit removed, can record any length
5. **File Size**: Displayed estimated size is approximate, actual size may vary

## 🎯 Shortcuts

- **ESC** - Cancel area selection
- **Click timeline frame numbers** - Jump to specific frame
- **Re-capture** - Re-select recording area in preview mode

## 🔧 Development

### Development Mode

```bash
npm run dev
```

### Build & Package

```bash
# Build all platforms
npm run build

# Build Windows only
npm run build:win

# Build macOS only
npm run build:mac

# Build Linux only
npm run build:linux
```

### CI/CD

The project uses GitHub Actions for automatic building:

- **Push to main branch** - Triggers build, uploads artifacts to Artifacts
- **Push tag** - Automatically creates Release and uploads installers

See [CI/CD Documentation](.github/workflows/README.md)

## 🐛 Known Issues

- macOS requires screen recording permission to function properly
- Windows Defender may flag as false positive, needs to add trust
- Importing very large GIF files may cause lag

## 📄 License

[MIT License](LICENSE)

## 🤝 Contributing

Issues and Pull Requests are welcome!

### Contribution Guide

1. Fork this project
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request
