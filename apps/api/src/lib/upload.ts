/**
 * Multipart image uploads (multer, in memory). Limits come from the shared constants; the actual
 * file type is checked from magic bytes (imageInfo), never from the client's mimetype.
 */
import type { Request, Response } from "express";
import multer from "multer";
import { MAX_SCREENSHOT_BYTES, MAX_SCREENSHOTS_PER_UPLOAD } from "@7xen/shared";
import { AppError } from "./errors.js";
import { imageInfo, sha256, type ImageInfo } from "./storage.js";

const MB = Math.round(MAX_SCREENSHOT_BYTES / (1024 * 1024));

const uploader = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_SCREENSHOT_BYTES,
    files: MAX_SCREENSHOTS_PER_UPLOAD,
    fields: 20,
    fieldSize: 200 * 1024,
  },
}).any();

/** Run multer and translate its errors into our error shape. */
export async function parseMultipart(req: Request, res: Response): Promise<void> {
  if (!req.is("multipart/form-data")) {
    throw new AppError("VALIDATION_ERROR", "Send the screenshot as a file upload (multipart/form-data)");
  }
  await new Promise<void>((resolve, reject) => {
    uploader(req, res, (err: unknown) => {
      if (!err) return resolve();
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return reject(new AppError("VALIDATION_ERROR", `Each image must be ${MB} MB or smaller`, { files: `Max ${MB} MB per image` }, 413));
        }
        if (err.code === "LIMIT_FILE_COUNT") {
          return reject(new AppError("VALIDATION_ERROR", `Upload up to ${MAX_SCREENSHOTS_PER_UPLOAD} images at a time`, { files: "Too many files" }));
        }
        return reject(new AppError("VALIDATION_ERROR", "That upload couldn't be read"));
      }
      reject(new AppError("VALIDATION_ERROR", "That upload couldn't be read"));
    });
  });
}

export interface UploadedImage {
  buffer: Buffer;
  originalName: string;
  info: ImageInfo;
  sha256: string;
}

/** Uploaded files from the given field names, validated as PNG/JPEG/WebP. */
export function uploadedImages(req: Request, fieldNames: string[]): UploadedImage[] {
  const files = ((req.files as Express.Multer.File[] | undefined) ?? []).filter((f) => fieldNames.includes(f.fieldname));
  return files.map((f) => {
    const info = imageInfo(f.buffer);
    if (!info) {
      throw new AppError("VALIDATION_ERROR", `"${f.originalname}" isn't a PNG, JPEG or WebP image`, { files: "Only PNG, JPEG or WebP images" });
    }
    return { buffer: f.buffer, originalName: f.originalname, info, sha256: sha256(f.buffer) };
  });
}

/** Exactly one image from `field`. */
export function singleImage(req: Request, field = "file"): UploadedImage {
  const [img, ...rest] = uploadedImages(req, [field, "files", "image"]);
  if (!img) throw new AppError("VALIDATION_ERROR", "Choose an image to upload", { [field]: "Choose an image" });
  if (rest.length) throw new AppError("VALIDATION_ERROR", "Upload one image at a time", { [field]: "One image only" });
  return img;
}
