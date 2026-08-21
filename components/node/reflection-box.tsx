"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { THIN_REFLECTION_WORDS, countWords } from "@/lib/signals";

/**
 * The word counter is not decoration. A reflection under 20 words is recorded as
 * `thin_reflection`, and showing the learner the threshold as they type is a
 * fairer deal than measuring them against a rule they cannot see.
 */
export function ReflectionBox({
  prompt,
  initialBody,
  save,
  initialPublic,
  setVisibility,
}: {
  prompt: string;
  initialBody: string;
  save: ((body: string) => Promise<void>) | null;
  initialPublic: boolean;
  /**
   * Null until the node is passed. Publishing a reflection written before doing
   * the work would not help anybody reading it, so the option simply is not
   * offered yet.
   */
  setVisibility: ((isPublic: boolean) => Promise<void>) | null;
}) {
  const [body, setBody] = useState(initialBody);
  const [savedBody, setSavedBody] = useState(initialBody);
  const [isPublic, setIsPublic] = useState(initialPublic);
  const [pending, startTransition] = useTransition();

  const words = countWords(body);
  const isThin = words > 0 && words < THIN_REFLECTION_WORDS;
  const dirty = body.trim() !== savedBody.trim();

  const onSave = () => {
    if (!save || !dirty) return;
    startTransition(async () => {
      await save(body);
      setSavedBody(body);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium tracking-widest uppercase">
          Reflection
        </CardTitle>
        <p className="max-w-prose leading-relaxed text-pretty">{prompt}</p>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Nobody grades this. It is the part you will want to read again in six months."
          rows={6}
          className="resize-y"
          aria-label="Your reflection"
        />

        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
          <span>
            {isThin
              ? `${words} words - under ${THIN_REFLECTION_WORDS} usually means "I did not really think about it".`
              : `${words} ${words === 1 ? "word" : "words"}`}
          </span>

          {save ? (
            <Button
              size="sm"
              variant={dirty ? "default" : "ghost"}
              onClick={onSave}
              disabled={!dirty || pending}
            >
              {pending ? "Saving..." : dirty ? "Save" : "Saved"}
            </Button>
          ) : (
            <span>Sign in to save.</span>
          )}
        </div>

        {setVisibility && savedBody.trim().length > 0 ? (
          <label className="hover:bg-accent/50 flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors">
            <Checkbox
              checked={isPublic}
              onCheckedChange={(next) => {
                const value = next === true;
                setIsPublic(value);
                startTransition(async () => setVisibility(value));
              }}
              className="mt-0.5 shrink-0"
            />
            <span className="text-sm leading-relaxed">
              Share this reflection with other learners
              <span className="text-muted-foreground block text-xs">
                Visible only to people who have also passed this node. You can
                turn it off again at any time.
              </span>
            </span>
          </label>
        ) : null}
      </CardContent>
    </Card>
  );
}
