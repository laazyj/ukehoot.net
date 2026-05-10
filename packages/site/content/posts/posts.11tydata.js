// Applies to every post in content/posts/. Each post lives at
// content/posts/<YYYY>/<slug>/index.md with media alongside; the canonical
// permalink mirrors that path so passthrough-copied media (photo-1.jpg etc.)
// resolves with simple relative URLs from the post page.
export default {
  layout: "layouts/post.njk",
  tags: ["post"],
  eleventyComputed: {
    permalink: (data) => {
      // page.filePathStem is "/posts/<YYYY>/<slug>/index"
      return data.page.filePathStem.replace(/\/index$/, "/");
    },
  },
};
