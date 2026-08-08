declare module "bn.js" {
  export default class BN {
    constructor(value: number | string, base?: number);
    isNeg(): boolean;
    gt(other: BN): boolean;
    toArray(endian?: "le" | "be", length?: number): number[];
    toString(base?: number): string;
  }
}
