require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

const app = express();

// Middleware
app.use(cors()); 
app.use(express.json());

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Atlas Connected Successfully'))
  .catch(err => console.error('MongoDB connection error:', err));

// =========================================================
// DATABASE SCHEMAS
// =========================================================

// Schema 1: Continuous Sensor Data
const TelemetrySchema = new mongoose.Schema({
  ldrValue: { type: Number, default: 0 },
  ledPowerPWM: { type: Number, default: 0 },
  motionTriggers: { type: Number, default: 0 },
  status: { type: String, default: "System Booting..." },
  signalStrength: { type: Number, default: -100 },
  timestamp: { type: Date, default: Date.now }
});
const Telemetry = mongoose.model('Telemetry', TelemetrySchema);

// Schema 2: Image Gallery History
const CaptureSchema = new mongoose.Schema({
  imageUrl: String,
  triggerSource: { type: String, default: "PIR Sensor" },
  timestamp: { type: Date, default: Date.now }
});
const Capture = mongoose.model('Capture', CaptureSchema);

const upload = multer({ storage: multer.memoryStorage() });

// =========================================================
// ROUTE 1: ESP32-CAM Image Upload
// =========================================================
app.post('/upload', upload.single('imageFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file received' });
  }

  const cld_upload_stream = cloudinary.uploader.upload_stream(
    { folder: 'lumen_iot_captures' },
    async (error, result) => {
      if (error) {
        console.error('Cloudinary Error:', error);
        return res.status(500).json({ error: 'Cloudinary upload failed' });
      }

      try {
        const newCapture = new Capture({
          imageUrl: result.secure_url
        });
        await newCapture.save();
        
        console.log('New image saved to gallery:', newCapture._id);
        res.status(200).json({ message: 'Upload successful', data: newCapture });
      } catch (dbError) {
        console.error('Database Error:', dbError);
        res.status(500).json({ error: 'Failed to save to database' });
      }
    }
  );

  streamifier.createReadStream(req.file.buffer).pipe(cld_upload_stream);
});

// =========================================================
// ROUTE 2: Standard ESP32 Live Telemetry
// =========================================================
app.post('/telemetry', async (req, res) => {
  try {
    const newTelemetry = new Telemetry({
      ldrValue: req.body.ldrValue,
      ledPowerPWM: req.body.ledPowerPWM,
      motionTriggers: req.body.motionTriggers,
      status: req.body.status,
      signalStrength: req.body.signalStrength
    });
    
    await newTelemetry.save();
    res.status(200).json({ message: 'Telemetry updated' });
  } catch (error) {
    console.error('Telemetry Error:', error);
    res.status(500).json({ error: 'Failed to save telemetry' });
  }
});

// =========================================================
// ROUTE 3: React Dashboard Aggregator
// =========================================================
app.get('/api/dashboard', async (req, res) => {
  try {
    const latestTelemetry = await Telemetry.findOne().sort({ timestamp: -1 });
    const recentCaptures = await Capture.find().sort({ timestamp: -1 }).limit(500);
    
    // NEW: Fetch the last 20 telemetry readings for the chart
    const rawHistory = await Telemetry.find().sort({ timestamp: -1 }).limit(50);
    
    // Reverse so oldest is on the left, newest on the right
    const telemetryHistory = rawHistory.reverse().map(doc => ({
      time: doc.timestamp,
      lux: doc.ldrValue
    }));
    
    res.json({
      telemetry: latestTelemetry || {
        ldrValue: 0,
        ledPowerPWM: 0,
        motionTriggers: 0,
        status: "Waiting for ESP32 connection...",
        signalStrength: 0
      },
      telemetryHistory: telemetryHistory,
      imageGallery: recentCaptures.map(cap => ({
        url: cap.imageUrl,
        timestamp: cap.timestamp
      })),
      liveStreamUrl: "http://10.168.180.191:81/stream"
    });
  } catch (error) {
    console.error('Dashboard API Error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

app.get('/', (req, res) => {
  res.send('LUMEN IoT Backend is running with Continuous Telemetry.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});