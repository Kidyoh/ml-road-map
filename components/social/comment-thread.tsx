"use client";

import { useState, useTransition } from "react";

import { CommentForm } from "@/components/social/comment-form";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { CommentNode } from "@/lib/social";

/**
 * One level of nesting. A reply to a reply attaches to the same root, which the
 * server enforces too - arbitrarily deep threads are unreadable on a phone and
 * nobody follows them past the third indent.
 */
function Comment({
  comment,
  depth,
  onReply,
  onDelete,
  canReply,
}: {
  comment: CommentNode;
  depth: number;
  onReply: (body: string, parentId: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  canReply: boolean;
}) {
  const [replying, setReplying] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className={depth > 0 ? "border-l pl-4" : undefined}>
      <div className="flex gap-3 py-3">
        <Avatar className="size-7 shrink-0">
          <AvatarImage
            src={comment.author.image ?? undefined}
            alt={comment.author.name ?? "Learner"}
          />
          <AvatarFallback className="text-xs">
            {(comment.author.name ?? "?").slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium">
              {comment.author.name ?? "A learner"}
            </span>
            <span className="text-muted-foreground text-xs">
              {comment.createdAtLabel}
            </span>
          </div>

          <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">
            {comment.body}
          </p>

          <div className="mt-1 flex items-center gap-1">
            {canReply && depth === 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setReplying((r) => !r)}
              >
                {replying ? "Cancel" : "Reply"}
              </Button>
            ) : null}
            {comment.isMine ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive h-7 px-2 text-xs"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await onDelete(comment.id);
                  })
                }
              >
                {pending ? "Deleting..." : "Delete"}
              </Button>
            ) : null}
          </div>

          {replying ? (
            <div className="mt-2">
              <CommentForm
                compact
                submitLabel="Reply"
                placeholder={`Reply to ${comment.author.name ?? "this"}`}
                post={(body) => onReply(body, comment.id)}
                onDone={() => setReplying(false)}
              />
            </div>
          ) : null}

          {comment.replies.map((reply) => (
            <Comment
              key={reply.id}
              comment={reply}
              depth={depth + 1}
              onReply={onReply}
              onDelete={onDelete}
              canReply={canReply}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function CommentThread({
  comments,
  post,
  remove,
  signedIn,
}: {
  comments: CommentNode[];
  post: (body: string, parentId?: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  signedIn: boolean;
}) {
  const count = comments.reduce((n, c) => n + 1 + c.replies.length, 0);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium tracking-widest uppercase">
          Discussion
        </h2>
        <span className="text-muted-foreground text-xs tabular-nums">
          {count === 0 ? "none yet" : `${count} comment${count === 1 ? "" : "s"}`}
        </span>
      </div>

      {signedIn ? (
        <CommentForm
          post={(body) => post(body)}
          placeholder="Ask something, or say what tripped you up. Do not paste answers."
        />
      ) : (
        <p className="text-muted-foreground text-sm">
          Sign in to join the discussion.
        </p>
      )}

      {comments.length > 0 ? (
        <div className="divide-y">
          {comments.map((comment) => (
            <Comment
              key={comment.id}
              comment={comment}
              depth={0}
              onReply={(body, parentId) => post(body, parentId)}
              onDelete={remove}
              canReply={signedIn}
            />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground py-4 text-sm">
          Nothing here yet. If you got stuck somewhere, saying where is useful to
          whoever arrives next.
        </p>
      )}
    </section>
  );
}
