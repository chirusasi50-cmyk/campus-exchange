import multer from "multer";

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const parseUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_SIZE, files: 1, fields: 1 },
  fileFilter(_req, file, callback) {
    callback(null, allowedMimeTypes.has(file.mimetype));
  },
}).single("file");

export default function attachmentUpload(req, res, next) {
  parseUpload(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ message: "Attachments must be 10 MB or smaller" });
    }
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ message: "Upload one image or PDF at a time" });
    }
    return next(error);
  });
}
