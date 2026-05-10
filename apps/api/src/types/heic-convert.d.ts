declare module "heic-convert" {
  interface ConvertOptions {
    buffer: Buffer | ArrayBuffer;
    format: "JPEG" | "PNG";
    quality?: number;
  }
  function heicConvert(options: ConvertOptions): Promise<ArrayBuffer>;
  export default heicConvert;
}
