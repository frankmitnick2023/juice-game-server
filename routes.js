const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const stream = require('stream');
const { Pool } = require('pg'); // 引入 Postgres 库

// 1. 配置 Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// 2. 配置数据库连接 (直接读取 Railway 的 DATABASE_URL)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const upload = multer({ storage: multer.memoryStorage() });

// 辅助函数：上传到 Cloudinary
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

// --- 路由定义 ---
router.post('/api/upload-trophy', 
    upload.fields([{ name: 'mainCert', maxCount: 1 }, { name: 'extraPhotos', maxCount: 5 }]), 
    async (req, res) => {
        try {
            // 获取用户ID (如果 session 里没有，暂时默认为 3，方便你测试)
            // 你可以根据实际情况改成 req.user.id
            const userId = req.user ? req.user.id : 3; 

            if (!req.files || !req.files['mainCert']) {
                return res.status(400).json({ error: 'Main certificate is required' });
            }

            console.log('Start uploading to Cloudinary...');

            // 1. 上传主图
            const mainCertUrl = await uploadToCloudinary(req.files['mainCert'][0].buffer, 'dance-game/certificates');
            console.log('Main Cert Uploaded:', mainCertUrl);

            // 2. 上传附图
            let extraUrls = [];
            if (req.files['extraPhotos']) {
                const uploadPromises = req.files['extraPhotos'].map(file => 
                    uploadToCloudinary(file.buffer, 'dance-game/moments')
                );
                extraUrls = await Promise.all(uploadPromises);
            }

            // 3. ★★★ 写入数据库 (之前这里被注释了，现在恢复) ★★★
            // 对应你截图里的表结构：user_id, image_path, extra_images, source_name, status
            const queryText = `
                INSERT INTO trophies (user_id, image_path, extra_images, source_name, status, created_at)
                VALUES ($1, $2, $3, $4, 'PENDING', NOW())
                RETURNING *
            `;
            
            const values = [
                userId, 
                mainCertUrl, 
                JSON.stringify(extraUrls),
                'User Upload' // source_name
            ];

            const dbResult = await pool.query(queryText, values);
            console.log('Database Insert Success:', dbResult.rows[0]);

            res.json({ success: true, data: dbResult.rows[0] });

        } catch (error) {
            console.error('Upload Process Error:', error);
            res.status(500).json({ error: 'Upload failed: ' + error.message });
        }
    }
);

module.exports = router;