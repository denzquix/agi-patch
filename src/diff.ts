
export type DiffOp = (
  | { type: 'delete', count: number }
  | { type: 'same', count: number }
  | { type: 'insert', bytes: Uint8Array }
);

export function diffBytes(a: Uint8Array, b: Uint8Array): DiffOp[] {
  const N = a.length, M = b.length, maxD = N + M;
  if (maxD === 0) return [];
  // Create an array V indexed from -maxD to maxD.
  // For simplicity, use an offset so that V[k] is stored at V[V_offset + k].
  const V_len = 2*maxD + 1;
  const V_offset = maxD;
  if (a.length > Number.MAX_SAFE_INTEGER) throw new Error('too long');
  const V = (
    a.length > 0xffffffff ? new Float64Array(V_len)
    : a.length > 0xffff ? new Uint32Array(V_len)
    : a.length > 0xff ? new Uint16Array(V_len)
    : new Uint8Array(V_len)
  );

  // 'trace' will record the state of V at each edit distance D for backtracking.
  const trace: Array<typeof V> = [];

  // Iterate through possible edit distances D.
  outer: for (let D = 0; ; D++) {
    if (D > maxD) {
      throw new Error('diff failed');
    };

    // Save a snapshot of the current V for backtracking.
    trace.push(V.slice());

    // Explore each possible diagonal k = x − y for the current D.
    for (let k = -D; k <= D; k += 2) {
      // Decide whether to follow an insertion or a deletion.
      let x: number;
      if (k === -D) {
        // Only option is an insertion (move down in the edit graph).
        x = V[V_offset + k + 1];
      }
      else if (k !== D && V[V_offset + k - 1] < V[V_offset + k + 1]) {
        // Choose insertion (down move) if it goes further.
        x = V[V_offset + k + 1];
      }
      else {
        // Otherwise choose deletion (right move).
        x = V[V_offset + k - 1] + 1;
      }

      let y = x - k;

      // Follow the “snake” (diagonal) while the elements match.
      while (x < N && y < M && a[x] === b[y]) {
        x++;
        y++;
      }

      // Store the furthest x reached for diagonal k.
      V[V_offset + k] = x;

      // If the end of both sequences is reached, return the trace for reconstruction.
      if (x >= N && y >= M) break outer;
    }
  }

  // backtracking stage:

  // Start from the end of both sequences.
  let x = a.length, y = b.length;
  const edits: DiffOp[] = [];

  const same = (a_pos: number) => {
    const last = edits[edits.length-1];
    if (last && last.type === 'same') {
      last.count++;
    }
    else {
      edits.push({type:'same', count:1});
    }
  };

  const insert = (b_pos: number) => {
    const last = edits[edits.length-1];
    if (last && last.type === 'insert') {
      last.bytes = new Uint8Array(last.bytes.buffer, last.bytes.byteOffset - 1, last.bytes.byteLength + 1);
    }
    else {
      edits.push({type:'insert', bytes:b.subarray(b_pos, b_pos + 1)});
    }
  };

  const del = (a_pos: number) => {
    const last = edits[edits.length-1];
    if (last && last.type === 'delete') {
      last.count++;
    }
    else {
      edits.push({type:'delete', count:1});
    }
  };

  // Traverse the trace from the last D back to 0.
  for (let D = trace.length-1; D >= 0; D--) {
    const V = trace[D];
    const k = x - y;

    // Determine the previous k value from which (x, y) was reached.
    let prevK: number;
    if ((k === -D) || (k !== D && V[V_offset + k - 1] < V[V_offset + k + 1])) {
      prevK = k + 1;
    }
    else {
      prevK = k - 1;
    }

    // Get the x coordinate from the previous step.
    const prevX = V[V_offset + prevK]
    const prevY = prevX - prevK

    // Trace back the diagonal (the matching "snake") from (x, y) to (prevX, prevY).
    while (x > prevX && y > prevY) {
      // Record a matching element (unchanged in both a and b).
      same(x - 1);
      x--;
      y--;
    }

    // If we've exhausted D = 0, break the loop.
    if (D === 0) break;

    // Determine the edit that produced the jump from the previous diagonal.
    if (x === prevX) {
      // An insertion was made in sequence a (i.e. element from b added).
      insert(prevY);
    }
    else {
      // A deletion was made from sequence a.
      del(prevX);
    }

    // Set (x, y) to the previous coordinates for the next iteration.
    x = prevX;
    y = prevY;
  }
  return edits.reverse();
}

export function applyDiff(input: Uint8Array, ops: DiffOp[]) {
  const output: Uint8Array[] = [];
  let pos = 0;
  let size = 0;
  for (const op of ops) {
    switch (op.type) {
      case 'delete':
        pos += op.count;
        break;
      case 'insert':
        output.push(op.bytes);
        size += op.bytes.length;
        break;
      case 'same':
        output.push(input.subarray(pos, pos + op.count));
        pos += op.count;
        size += op.count;
        break;
    }
  }
  const final = new Uint8Array(size);
  let final_pos = 0;
  for (let i = 0; i < output.length; i++) {
    final.set(output[i], final_pos);
    final_pos += output[i].length;
  }
  return final;
}
