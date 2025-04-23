
export type BytePatch = string;

export interface PatchJSON {
  formatVersion: number;
  type: 'agi';
  words?: {
    [word: string]: number | null;
  };
  logic?: {
    [num: number]: null | {
      bytecode?: BytePatch;
      messages?: {
        [num: number]: BytePatch | null;
      };
    };
  };
}
