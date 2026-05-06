// pdf-parse@1.1.1 ships a debug guard at its index.js that fires under
// Vitest / Next bundling. We import the inner lib file directly to skip
// it. @types/pdf-parse only declares the package entry, so we re-declare
// the deep path with the same shape here.
declare module "pdf-parse/lib/pdf-parse.js" {
  import pdf from "pdf-parse";
  export default pdf;
}
