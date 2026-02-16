# Teams Transcript

**Meeting:** Meeting with Deep Bhattacharyya | Microsoft | deepbh@microsoft.com | Microsoft T...

**Captured:** 2026-02-14 22:02:17

**Participants (1):**

- Deep Bhattacharyya

**Stats:**

- Total captions: 29
- Start time: 22:00:47
- End time: 22:02:12
- Duration: 1 minutes

---

**[22:00:47] Deep Bhattacharyya:**

> Is.

> Is when your server actually needs to do work, and almost all of the content on this website actually is fairly static content, right?

> If you if you go ahead and look at a lot of these requests that are coming in, you'll see that it's it's just Jason that's that's coming in, right.

> So it's it's just text.

> Text can be cached.

> Very heavily. The stuff on here is not changing very often.

> The guy's dead, right?

> He's not sending any more emails.

> Well, I guess that's maybe up for debate, but.

> There's a lot of.

> Stuff that can be be cash on here, so I don't know.

> It certainly is probably a big expense here, but probably not the biggest one because they're not doing things like they're not. OCR ring on demand.

> They're they're not doing any really heavy intensive stuff.

> They are somebody just rendering out react elements on a page and then caching those heavily.

> So the next one is bandwidth, and this is probably a big one, but not what you might think, right?

> You think like oh, images and and whatnot.

> So if you go to one of the images that are on this website that you'll see that they are hosted on a totally separate domain name and this URL here and had it looking at the headers tells me they're using Cloudflare image transformations to.

> Resize them so they're they're not as big to load on on page load, and they're not using up as much bandwidth.

> So most of the images on here are probably are not even part of that vercel build, because they're they're hosted totally separately.

> But if we go let's go to this home page.

> Here do a hard refresh and then sort them by size.

> You'll see.

> There are some things that are being hosted on this.

> This biggest one right here is over half a Meg for a little icon that's being loaded here. If we open that up in a new tab, this is a little Facebook icon, not compressed at all, and probably way larger than it needs to be, and probably could be in SVG.

> So serving that up, plus there are several other like images that are being loaded in here and adding all those up, it's about a Meg plus. You're looking at all of the JavaScript and CSS bundles that are being loaded up.

> That's probably close to another Meg as well.

> So every single person visiting the website, fresh cash you're they're using two megs of bandwidth, which is is is quite a bit. Then the other part of the bandwidth here is this aggressive preloading.

> So if I go to my dev tools, I'm going to philtre for XHR and then as I simply just scroll, you'll see that there's like tonnes of requests being being fired off.

> Now I have my cache disabled here, so they are loading from my disc cache, but the first time that you hover over top of those you'll see it's just a bunch of Jason being loaded but.

