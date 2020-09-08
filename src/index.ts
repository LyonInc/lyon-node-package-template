export default function add(a: number, b: number): number {
  if (__DEV__) {
    console.log('This is dev only');
  }
  return a + b;
}
