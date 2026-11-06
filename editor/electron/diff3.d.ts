declare module 'diff3' {
  interface Diff3Result {
    ok?: string[];
    conflict?: { a: string[]; o: string[]; b: string[] };
  }
  export default function diff3Merge(a: string[], o: string[], b: string[]): Diff3Result[];
}
