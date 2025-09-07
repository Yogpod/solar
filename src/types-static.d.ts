// Allow importing PNG images so Vite can process & hash them
declare module '*.png' {
  const src: string;
  export default src;
}
