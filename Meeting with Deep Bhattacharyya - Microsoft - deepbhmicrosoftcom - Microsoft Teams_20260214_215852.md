# Teams Transcript

**Meeting:** Meeting with Deep Bhattacharyya | Microsoft | deepbh@microsoft.com | Microsoft T...

**Captured:** 2026-02-14 21:59:52

**Participants (1):**

- Deep Bhattacharyya

**Stats:**

- Total captions: 22
- Start time: 21:58:52
- End time: 21:59:47
- Duration: < 1 minute

---

**[21:58:52] Deep Bhattacharyya:**

> $46,000 vercel bill, how does that possibly happen?

> This was the creators of Jmail.

> They've taken every single one of the Epstein emails and built this like Gmail interface, so you can sort of click through and read them and load them and philtre them by different people.

> It's a really sick website, but they've racked up a $46,000 vercel bill.

> I have large sites running on Vercel, Cloudflare and VPS and I did some quick back of the napkin math and I think know where most of this bill went to and we're going to break it down.

> So hopefully it doesn't happen to you as well.

> Let's break it down into four sort of categories.

> You got compute bandwidth requests and like special add-on services, right?

> So compute is when your application actually needs to run some processes, right?

> Whether it's it's fetching data from the database, looping over arrays, whether it's handling a URL and routing it to wherever you go that.

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

> It certainly is probably a big

