import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { PublicReflection } from "@/lib/social";

/**
 * Other learners' reflections, shown only once you have passed the node.
 *
 * The gate is the point. A reflection prompt asks the question whose value is in
 * answering it yourself - "what made the leaky version look convincing" is
 * worthless if you have just read three people's answers. So these appear as a
 * reward for finishing rather than as material to work from.
 */
export function PublicReflections({
  reflections,
}: {
  reflections: PublicReflection[];
}) {
  if (reflections.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium tracking-widest uppercase">
          How others answered
        </h2>
        <p className="text-muted-foreground text-sm">
          Nobody has published a reflection on this node yet. Yours would be the
          first &mdash; there is a toggle on your own reflection above.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium tracking-widest uppercase">
          How others answered
        </h2>
        <span className="text-muted-foreground text-xs tabular-nums">
          {reflections.length}
        </span>
      </div>

      <p className="text-muted-foreground text-sm">
        Shown because you have passed this node. Reading these before doing the
        work would have cost you the whole point of the prompt.
      </p>

      <div className="flex flex-col gap-4">
        {reflections.map((reflection) => (
          <figure
            key={reflection.id}
            className="bg-muted/30 rounded-md border p-4"
          >
            <blockquote className="text-sm leading-relaxed whitespace-pre-wrap">
              {reflection.body}
            </blockquote>
            <figcaption className="text-muted-foreground mt-3 flex items-center gap-2 text-xs">
              <Avatar className="size-5">
                <AvatarImage
                  src={reflection.author.image ?? undefined}
                  alt={reflection.author.name ?? "Learner"}
                />
                <AvatarFallback className="text-[9px]">
                  {(reflection.author.name ?? "?").slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {reflection.author.name ?? "A learner"}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
