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

// Database Schema for Streetlight Telemetry
const TelemetrySchema = new mongoose.Schema({
  imageUrl: String,
  ldrValue: Number,
  motionDetected: Boolean,
  timestamp: { type: Date, default: Date.now }
});
const Telemetry = mongoose.model('Telemetry', TelemetrySchema);

// Configure Multer to store the incoming image in memory temporarily
const upload = multer({ storage: multer.memoryStorage() });

// ---------------------------------------------------------
// ROUTE 1: For the ESP32-CAM to POST data & images
// ---------------------------------------------------------
app.post('/upload', upload.single('imageFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file received' });
  }

  // Parse sensor data sent alongside the image
  const ldrValue = req.body.ldr || 0;
  const motionDetected = req.body.motion === 'true' || req.body.motion === '1';

  // Upload the image buffer directly to Cloudinary
  const cld_upload_stream = cloudinary.uploader.upload_stream(
    { folder: 'lumen_iot_captures' },
    async (error, result) => {
      if (error) {
        console.error('Cloudinary Error:', error);
        return res.status(500).json({ error: 'Cloudinary upload failed' });
      }

      // Save the Cloudinary URL and sensor data to MongoDB
      try {
        const newData = new Telemetry({
          imageUrl: result.secure_url,
          ldrValue: ldrValue,
          motionDetected: motionDetected
        });
        await newData.save();
        
        console.log('New telemetry saved:', newData._id);
        res.status(200).json({ message: 'Upload successful', data: newData });
      } catch (dbError) {
        console.error('Database Error:', dbError);
        res.status(500).json({ error: 'Failed to save to database' });
      }
    }
  );

  // Convert the memory buffer into a stream for Cloudinary
  streamifier.createReadStream(req.file.buffer).pipe(cld_upload_stream);
});

// ---------------------------------------------------------
// ROUTE 2: For the React Dashboard to GET the latest data
// ---------------------------------------------------------
app.get('/api/latest-data', async (req, res) => {
  try {
    // Find the single most recent entry based on timestamp
    const latestData = await Telemetry.findOne().sort({ timestamp: -1 });
    
    if (!latestData) {
      return res.status(404).json({ message: 'No telemetry data found yet' });
    }
    
    res.json(latestData);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// Basic health check route
app.get('/', (req, res) => {
  res.send('LUMEN IoT Backend is running natively.');
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});