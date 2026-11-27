export function choice(source, promptText, choices, correctChoiceIndex) {
  return { source, promptText, type: "choice", choices, correctChoiceIndex };
}

export function written(source, promptText, answerText, ...acceptedAnswers) {
  return { source, promptText, type: "text", answerText, acceptedAnswers };
}

export function numeric(source, promptText, numericTarget, numericUnit) {
  return { source, promptText, type: "numeric-closest", numericTarget, numericUnit };
}

export function toPackDraft({ title, description, rounds, finals }) {
  function topic(title, roundIndex, isFinal, questions) {
    return {
      title,
      roundIndex,
      isFinal,
      ordered: !isFinal,
      direction: "forward",
      questions: questions.map(({ source, ...question }, index) => ({
        answerText: "",
        acceptedAnswers: [],
        choices: [],
        correctChoiceIndex: null,
        ...question,
        answerMode: isFinal || question.type !== "text" || index % 4 === 3 ? "everyone" : "buzzer",
        answerTimeSeconds: isFinal ? 45 : 30,
        value: (index + 1) * 100,
      })),
    };
  }

  return {
    title,
    description,
    rounds: rounds.map(([name]) => name),
    topics: [
      ...rounds.flatMap(([, topics], index) =>
        topics.map(([name, questions]) => topic(name, index, false, questions)),
      ),
      ...finals.map(([name, question]) => topic(name, rounds.length - 1, true, [question])),
    ],
  };
}
