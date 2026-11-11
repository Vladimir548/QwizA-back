import { distance } from "fastest-levenshtein";

export const normalizeAnswer = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replaceAll("ё", "е")
    .replace(/[^а-яa-z0-9]/g, "");

export function matchesTextAnswer(
  response: string,
  correctAnswer: string,
  acceptedAnswers: string[] = [],
): boolean {
  const normalizedResponse = normalizeAnswer(response);
  if (!normalizedResponse) return false;
  return [correctAnswer, ...acceptedAnswers].some((candidate) => {
    const normalizedCandidate = normalizeAnswer(candidate);
    if (!normalizedCandidate) return false;
    if (normalizedResponse === normalizedCandidate) return true;
    return (
      normalizedResponse.length >= 5 &&
      normalizedCandidate.length >= 5 &&
      distance(normalizedResponse, normalizedCandidate) <= 1
    );
  });
}
