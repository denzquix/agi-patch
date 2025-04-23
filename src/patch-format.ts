
export interface PatchJSON {
  formatVersion: number;
  type: 'agi';
  words?: {
    [word: string]: number | null;
  };
}
