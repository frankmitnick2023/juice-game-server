// routes.js
const express = require('express');
const router = express.Router(); // 1. 创建路由对象
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const stream = require('stream');

// --- 配置区 ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({ storage: multer.memoryStorage() });

// --- 辅助函数 ---
const uploadToCloudinary = (fileBuffer, folder) => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            { folder: folder },
            (error, result) => {
                if (result) resolve(result.secure_url);
                else reject(error);
            }
        );
        const bufferStream = new stream.PassThrough();
        bufferStream.end(fileBuffer);
        bufferStream.pipe(uploadStream);
    });
};

// --- 路由定义 (注意这里用 router.post) ---
router.post('/api/upload-trophy', 
    upload.fields([{ name: 'mainCert', maxCount: 1 }, { name: 'extraPhotos', maxCount: 5 }]), 
    async (req, res) => {
        try {
            // 注意：这里需要确保 req.user 存在。如果你的登录验证中间件在 server.js 里，
            // 这里可能拿不到 user。暂时先用 1 或者 req.body.userId 测试
            const userId = req.user ? req.user.id : (req.body.userId || 1); 

            if (!req.files || !req.files['mainCert']) {
                return res.status(400).json({ error: 'Main certificate is required' });
            }

            // 上传主图
            const mainCertUrl = await uploadToCloudinary(req.files['mainCert'][0].buffer, 'dance-game/certificates');

            // 上传附图
            let extraUrls = [];
            if (req.files['extraPhotos']) {
                const uploadPromises = req.files['extraPhotos'].map(file => 
                    uploadToCloudinary(file.buffer, 'dance-game/moments')
                );
                extraUrls = await Promise.all(uploadPromises);
            }

            // 数据库操作 (需要引入你的 db)
            // 假设你在 server.js 里导出了 db，或者在这里重新 require 它
            // const db = require('./db'); // <--- 记得这里要能连上数据库
            
            // 为了演示，我们先假设直接返回成功，你需要在这里补上真实的数据库写入代码
            /* const result = await db.query(
                `INSERT INTO trophies ... VALUES ... RETURNING *`, 
                [userId, mainCertUrl, JSON.stringify(extraUrls)]
            );
            */

            console.log("Upload Success:", mainCertUrl);
            res.json({ success: true, data: { image_path: mainCertUrl, extra_images: extraUrls } });

        } catch (error) {
            console.error('Upload Error:', error);
            res.status(500).json({ error: 'Upload failed: ' + error.message });
        }
    }
);

// --- 导出路由 ---
module.exports = router;