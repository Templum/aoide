export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error(
      `Vector length mismatch: vecA has ${vecA.length} dimensions, vecB has ${vecB.length} dimensions.`,
    );
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }

  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
  if (magnitude === 0) {
    throw new Error('Cannot compute cosine similarity for a zero-magnitude vector.');
  }

  return dot / magnitude;
}
