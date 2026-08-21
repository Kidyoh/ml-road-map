import type { MDXComponents } from "mdx/types";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";

/**
 * MDX prose styling.
 *
 * Written as an explicit component map rather than a typography plugin because
 * the node bodies lean on three things heavily - tables, code blocks, and
 * `details` folds for ablation results - and those need to read correctly in
 * both themes and scroll horizontally on a phone without pushing the page.
 */
const components: MDXComponents = {
  h2: (props) => (
    <h2
      className="mt-10 mb-3 scroll-mt-20 border-t pt-8 text-xl font-semibold tracking-tight first:mt-0 first:border-0 first:pt-0"
      {...props}
    />
  ),
  h3: (props) => (
    <h3 className="mt-8 mb-2 scroll-mt-20 text-base font-semibold" {...props} />
  ),
  h4: (props) => <h4 className="mt-6 mb-2 text-sm font-semibold" {...props} />,
  p: (props) => (
    <p className="my-4 max-w-prose leading-relaxed text-pretty" {...props} />
  ),
  a: (props) => (
    <a
      className="text-primary underline underline-offset-4"
      target={props.href?.startsWith("http") ? "_blank" : undefined}
      rel={props.href?.startsWith("http") ? "noreferrer noopener" : undefined}
      {...props}
    />
  ),
  ul: (props) => (
    <ul className="my-4 max-w-prose list-disc space-y-2 pl-6" {...props} />
  ),
  ol: (props) => (
    <ol className="my-4 max-w-prose list-decimal space-y-2 pl-6" {...props} />
  ),
  li: (props) => <li className="leading-relaxed" {...props} />,
  strong: (props) => <strong className="font-semibold" {...props} />,
  blockquote: (props) => (
    <blockquote
      className="border-primary/40 text-muted-foreground my-6 max-w-prose border-l-2 pl-4 italic"
      {...props}
    />
  ),
  hr: () => <hr className="my-10" />,
  // Wide content scrolls inside its own box rather than making the page scroll.
  table: (props) => (
    <div className="my-6 overflow-x-auto rounded-md border">
      <table className="w-full text-sm" {...props} />
    </div>
  ),
  thead: (props) => <thead className="bg-muted/50" {...props} />,
  th: (props) => (
    <th
      className="border-b px-4 py-2.5 text-left font-medium whitespace-nowrap"
      {...props}
    />
  ),
  td: (props) => <td className="border-b px-4 py-2.5 align-top" {...props} />,
  pre: (props) => (
    <pre
      className="bg-muted my-6 overflow-x-auto rounded-md border p-4 font-mono text-sm leading-relaxed"
      {...props}
    />
  ),
  code: (props) => {
    // Fenced blocks arrive already wrapped in <pre>; only inline code needs the
    // pill treatment, and it would look wrong applied twice.
    const isInline = typeof props.children === "string";
    return isInline ? (
      <code
        className="bg-muted rounded px-1.5 py-0.5 font-mono text-[0.875em]"
        {...props}
      />
    ) : (
      <code className="font-mono" {...props} />
    );
  },
  details: (props) => (
    <details className="bg-muted/30 my-6 rounded-md border px-4 py-3" {...props} />
  ),
  summary: (props) => (
    <summary
      className="hover:text-primary cursor-pointer text-sm font-medium select-none"
      {...props}
    />
  ),
};

export function MdxBody({ source }: { source: string }) {
  return (
    <div className="text-[0.9375rem]">
      <MDXRemote
        source={source}
        components={components}
        // Without GFM, pipe tables render as literal pipe characters. Node 0.3
        // and 2.3 both carry tables that are load-bearing (the ablation results,
        // the list of what is wrong with the CSVs), so this is not optional.
        options={{ mdxOptions: { remarkPlugins: [remarkGfm] } }}
      />
    </div>
  );
}
