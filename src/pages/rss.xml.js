import rss from '@astrojs/rss';

export async function GET(context) {
  const allPosts = await import.meta.glob('./posts/*.md', { eager: true });
  const now = new Date();

  const publishedPosts = Object.values(allPosts)
    .filter((post) => new Date(post.frontmatter.date) <= now)
    .sort((a, b) => new Date(b.frontmatter.date) - new Date(a.frontmatter.date));

  return rss({
    title: 'Ultimate Edge Blog',
    description: 'Practical, up-to-date guides on JAMB, WAEC, NECO, and the Nigerian university admission process.',
    site: context.site ?? 'https://blog.ultimateedge.info',
    items: publishedPosts.map((post) => ({
      title: post.frontmatter.title,
      description: post.frontmatter.description,
      pubDate: new Date(post.frontmatter.date),
      link: post.url,
      categories: post.frontmatter.category ? [post.frontmatter.category] : [],
    })),
    customData: `<language>en-us</language>`,
  });
}
