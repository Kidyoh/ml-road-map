/**
 * An exam prompt: plain text with its line breaks kept, because prompts carry
 * code and small tables. The one thing it adds is turning a dataset path into
 * a download link, so a timed question does not cost a minute of URL-typing.
 */
export function PromptText({ text }: { text: string }) {
  const parts = text.split(/(\/datasets\/[\w.-]*\w)/g);
  return (
    <p className="max-w-prose text-sm leading-relaxed whitespace-pre-wrap">
      {parts.map((part, i) =>
        part.startsWith("/datasets/") ? (
          <a
            key={i}
            href={part}
            download
            className="text-primary font-mono text-[0.85em] underline underline-offset-4"
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  );
}
