import { useState } from "react";
import { catalogFor, resolveLocale } from "../localization";

export function RulesChallenge() {
  const locale = typeof navigator === "undefined" ? "en" : resolveLocale(navigator.languages.length ? navigator.languages : [navigator.language]);
  const copy = catalogFor(locale).practice;
  const challenges = copy.questions;
  const [step, setStep] = useState(0);
  const [answer, setAnswer] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const finished = step >= challenges.length;

  const choose = (index: number) => {
    if (answer !== null || finished) return;
    setAnswer(index);
    if (index === challenges[step].answer) setScore((value) => value + 1);
  };

  const next = () => {
    setAnswer(null);
    setStep((value) => value + 1);
  };

  const restart = () => {
    setStep(0);
    setAnswer(null);
    setScore(0);
  };

  return (
    <details className="rules-challenge" lang={locale}>
      <summary><span>{copy.summary}</span><strong>{copy.accessibleName} <span aria-hidden="true">+</span></strong></summary>
      <section className="rules-challenge-content" aria-label={copy.accessibleName}>
        <p>{copy.intro}</p>
        {finished ? (
          <div className="rules-challenge-result" role="status">
            <strong>{copy.complete(score, challenges.length)}</strong>
            <p>{copy.resultSummary} {copy.referenceLinks.map((link, index) => <span key={link.href}>{index > 0 ? (index === copy.referenceLinks.length - 1 ? ", and " : ", ") : ""}<a href={link.href}>{link.label}</a></span>)}.</p>
            <button type="button" onClick={restart}>{copy.tryAgain}</button>
          </div>
        ) : (
          <div className="rules-challenge-question" aria-live="polite">
            <p className="rules-challenge-progress">{copy.questionProgress(step + 1, challenges.length)}</p>
            <h2>{challenges[step].prompt}</h2>
            <div className="rules-challenge-choices">
              {challenges[step].choices.map((choice, index) => (
                <button
                  aria-pressed={answer === index}
                  className={answer === index ? (index === challenges[step].answer ? "is-correct" : "is-incorrect") : ""}
                  disabled={answer !== null}
                  key={choice}
                  onClick={() => choose(index)}
                  type="button"
                >{choice}</button>
              ))}
            </div>
            {answer !== null && (
              <div className="rules-challenge-feedback" role="status">
                <p><strong>{answer === challenges[step].answer ? copy.correct : copy.incorrect}</strong> {challenges[step].explanation} <a href={`/reference.html#${challenges[step].reference}`}>{copy.reviewRule}</a>.</p>
                <button type="button" onClick={next}>{step === challenges.length - 1 ? copy.seeResult : copy.nextQuestion}</button>
              </div>
            )}
          </div>
        )}
      </section>
    </details>
  );
}
