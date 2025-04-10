const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

// Get port and data directory from command line arguments
const port = process.argv[2] || 3000;
const dataDir = process.argv[3] || './data';

// Create Express app
const app = express();

// Enable CORS
app.use(cors());

// Create data directory if it doesn't exist
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`Created data directory: ${dataDir}`);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const category = req.body.category || 'default';
    const categoryDir = path.join(dataDir, category);
    
    if (!fs.existsSync(categoryDir)) {
      fs.mkdirSync(categoryDir, { recursive: true });
    }
    
    cb(null, categoryDir);
  },
  filename: (req, file, cb) => {
    // Generate a unique filename to avoid collisions
    const uniqueFilename = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueFilename);
  }
});

const upload = multer({ storage });

// File upload endpoint
app.post('/file/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }
    
    const category = req.body.category || 'default';
    const relativePath = path.join(category, req.file.filename);
    
    console.log(`File uploaded: ${relativePath}`);
    
    return res.json({
      success: true,
      filePath: relativePath,
      originalName: req.file.originalname
    });
  } catch (error) {
    console.error('File upload error:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// File download endpoint
app.get('/file/download', (req, res) => {
  try {
    const filePath = req.query.path;
    
    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: 'No file path provided'
      });
    }
    
    const fullPath = path.join(dataDir, filePath);
    
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }
    
    return res.download(fullPath);
  } catch (error) {
    console.error('File download error:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`File server listening on port ${port}`);
  console.log(`Data directory: ${dataDir}`);
});
