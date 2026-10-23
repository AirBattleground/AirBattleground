/**
 * A player's photo before upload: centre-cropped to a square and shrunk to 512px (WebP, or JPEG where the browser
 * can't encode WebP), so a 5 MB phone photo becomes ~50 KB. Throws when the browser can't decode the file.
 */
const SIZE = 512;

export async function squareAvatar(file: File): Promise<File> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(SIZE, side);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const encode = (type: string, q: number) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, q));
  let blob = await encode("image/webp", 0.88);
  if (!blob || blob.type !== "image/webp") blob = await encode("image/jpeg", 0.88);
  if (!blob) throw new Error("encode failed");
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  return new File([blob], `avatar.${ext}`, { type: blob.type });
}
