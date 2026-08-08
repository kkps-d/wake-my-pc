declare module "write-file-atomic" {
  interface WriteFileAtomicOptions {
    encoding?: BufferEncoding;
  }

  function writeFileAtomic(
    filename: string,
    data: string,
    options?: WriteFileAtomicOptions,
  ): Promise<void>;

  export default writeFileAtomic;
}
