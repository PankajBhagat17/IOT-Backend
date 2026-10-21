require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

const app = express();

// Middleware
app.use(cors()); // Allows your React frontend to fetch data
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
// DATABASE SCHEMAS (Separating live stats from image history)
// =========================================================

// Schema 1: Continuous Sensor Data (Phase 2 Prep)
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

// Configure Multer to store the incoming image in memory temporarily
const upload = multer({ storage: multer.memoryStorage() });

// =========================================================
// ROUTE 1: ESP32-CAM Image Upload (Event-Driven)
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

      // Save the image exclusively to the Capture gallery
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
// ROUTE 2: Standard ESP32 Live Telemetry (Continuous Update)
// =========================================================
app.post('/telemetry', async (req, res) => {
  try {
    // This will overwrite/log the continuous state from the main ESP32
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
    // 1. Get the single most recent continuous telemetry reading
    const latestTelemetry = await Telemetry.findOne().sort({ timestamp: -1 });
    
    // 2. Get the 10 most recent images for the gallery
    const recentCaptures = await Capture.find().sort({ timestamp: -1 }).limit(10);
    
    // 3. Package them together for the React frontend
    res.json({
      telemetry: latestTelemetry || {
        ldrValue: 0,
        ledPowerPWM: 0,
        motionTriggers: 0,
        status: "Waiting for ESP32 connection...",
        signalStrength: 0
      },
      imageGallery: recentCaptures.map(cap => ({
        url: cap.imageUrl,
        timestamp: cap.timestamp
      })),
      liveStreamUrl: "http://10.168.180.191:81/stream" // Reserved for Phase 3
    });
  } catch (error) {
    console.error('Dashboard API Error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Basic health check route
app.get('/', (req, res) => {
  res.send('LUMEN IoT Backend is running with Continuous Telemetry.');
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});