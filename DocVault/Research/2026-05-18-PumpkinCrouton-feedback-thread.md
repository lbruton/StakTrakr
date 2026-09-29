---
title: "What do you use to remember what was lost in the boating accident? My solution..."
source: "https://www.reddit.com/r/Silverbugs/comments/1r1aerl/comment/omehvv7/?context=1"
author:
  - "[[orphenshadow]]"
published: 2026-02-10
created: 2026-05-17
description: "Like everyone here I see the posts asking and the same answers about apmex's app etc. and to be honest all those solutions left me wanting m"
tags:
  - "clippings"
---
Like everyone here I see the posts asking and the same answers about apmex's app etc. and to be honest all those solutions left me wanting more. So I dusted off my decades old knowledge of programming and sold my soul to claude.

I loved the posts sharing all the screenshots of everyone badass excel sheets and I have a pretty beefy excel sheet myself but then I decided I would just make my own tracker.

It really helped keep me sane while the prices were too rich for my wallet :P

I have been working on it a lot as I track my own stack and v3.21 is the first time I really feel proud of it what it's become.

It includes a year of price history and you can configure your own api's. It also includes numista API for item lookup. Ebay lookups as well.

PCGS api integration for cert lookup and verification, NGC and others open in iframe with links to the appropriate verification pages.

Full encrypted backup/restore so you can save your inventory to your own storage and restore.

Custom Filter Chips, that allow you to "stack" your collection for quick filter views.

Breakdowns by purchase location and metal types of profit/loss

Future plans are to expand more breakdowns of profit/loss reporting, add supabase cloud storage so you can bring your own key and sync.

It's entirely free to use, or you can visit the github download it yourself and use offline.

I don't want or need your data, it belongs to YOU. I'm not asking for money or even saying you need to use this tool.

All I want to do is share something I created with my favorite group of people who might enjoy it and offer some feedback. I apologize if this post is breaking any rules. like I said, I'm not trying to promote so much as just get some feedback.

[https://github.com/lbruton/StackTrackr](https://github.com/lbruton/StackTrackr)

[https://staktrakr.com](https://staktrakr.com/) live mirror.

![r/Silverbugs - What do you use to remember what was lost in the boating accident? My solution...](https://preview.redd.it/what-do-you-use-to-remember-what-was-lost-in-the-boating-v0-2grpibdgupig1.png?width=1080&crop=smart&auto=webp&s=b8119e2f8fe2e532b8338f3b10cbcd2bbae08f8f)

---

## Comments

> **PumpkinCrouton** · [2026-05-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/okxsfdt/) · 1 points
> 
> Whew, too far down in the weeds to find the end of the thread again. Noticed a minor change in some fonts. Figured it was you fitting things in better but might be me as I'm constantly plugging holes in Chrome with my finger. The Capsule fields really caught me by surprise. Haven't gotten too far into them but it appears to be predicting based on the sizes. This glitch(?) surprised me too. I've gotten too ana... um particular about the pictures in the inventory. Some of Numista's pictures are sub par. Ended up downloading better pictures and more date specific pictures. That was a PITA because a lot of my stuff is a little obscure and I ran all over the web looking. Then I didn't like the white fields around many of the pictures in inventory so I started running my pics thru cropping online and uploading them. Everything was going fine. Then I pulled some pics of a Pt coin in assay because I couldn't find it raw, and this happened:
> 
> ![Comment Image](https://preview.redd.it/what-do-you-use-to-remember-what-was-lost-in-the-boating-v0-drd3fd59370h1.jpeg?width=1903&format=pjpg&auto=webp&s=9dab19c4482c48bdeb2466f244adafad67f8fde3)
> 
> Hah! Shows fine in the edit window but weird in the inventory and looks like this in the popup. Tried uploading an already known good pic for it but it still happens. I know, I know, probably a one off oddity of a corrupted entry. I'll delete the item and re enter it. Have to screenshot the data first because it was a weird one to track down, and I still don't have a pic of the loose coin like I want. Looking good these days!
> 
> > **orphenshadow** · [2026-05-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/okxupct/) · 1 points
> > 
> > Thanks, the capsule field was a suggestion in another reddit post, and I originally wanted to have it show you the exact capsule but ended up just basing the suggestion on the size in the radius, since as we know, numista can sometimes be wrong.
> > 
> > I also added the ability to attach a pdf/image to an item. I'm still testing this one out and finishing up the rough edges but it was requested to be able to append a receipt or document to an item, like a COA, etc.
> > 
> > Now for the issue with the coin shape, this is not a problem on your end, It's a known issue. The code automatically wraps the coins with a round wrapper and that's kind of what makes them all the same size and pop. If you change the shape to rectangle or other, it should show the entire slab.
> > 
> > When I fixed this the first time I applied the fix based on the coin shape, but this wont work in this case because the coin is not rectangle, the slab is. I need to think about the best way to handle this, I suspect that the solution will be to have it switch the shape to rectangle if there is a cert# or NGC/PGCS slab.
> > 
> > But if you want a quick fix until I can patch it, just edit the catalog data and select "other" for shape. 😄
> > 
> > > **PumpkinCrouton** · [2026-05-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/oky69o4/) · 1 points
> > > 
> > > Huh. I, uh, hmmm. Now that you mention it, I had not noticed. I have slabbed bars in there with no problem but of course they are designated as bars, and rectangular. I changed it to rectangular but it did the same. I had to change it to a bar in order to have it display right. The only slabbed coin I have (I think) is a platinum coin but I had put the pictures in of the individual coin, not the slab so I didn't run across this earlier. That is similar to what I'm trying to do with this coin but all I could find are pictures of it in the slab so I put those in until I can find a good individual coin picture to plug in there. I may have to breakdown and take my own pictures of it if it continues to elude me. When I finally have the coin picture I want, I'll just plug those in and change it back, and it will be a non issue on my end.
> > > 
> > > I got a 100oz bar in the mail this week. It came with the original receipt from 2015. So, just saying, original receipts can be somewhat depressing.
> > > 
> > > Hope your enforced rest went well.
> > > 
> > > > **orphenshadow** · [2026-05-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/ol36wpg/) · 1 points
> > > > 
> > > > ![Comment Image](https://preview.redd.it/what-do-you-use-to-remember-what-was-lost-in-the-boating-v0-jd6pukbhee0h1.png?width=775&format=png&auto=webp&s=d61294118761ea3946bbea1343c4fbdeb88fc84d)
> > > > 
> > > > Okay, I just pushed the fix to the beta site, Now there are two more ways that it will swap from round to square, If you select a grading authority it will default to rectangle expecting a slab.
> > > > 
> > > > But the real fix is the little toggle on the upload page. (note: the buttons are a little rough atm, I intend to go back and clean this section up later) Now you can toggle between A = Auto, or Circle or Rectangle for each item and it will change the behavior in the view modal and table.
> > > > 
> > > > > **PumpkinCrouton** · [2026-05-18](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/omehvv7/) · 1 points
> > > > > 
> > > > > Always adding more. Added some receipts and pics of packages to the add ons on items. Still get the occasion minor glitch. Added some silver yesterday and some of the Numista numbers ended up on items that had no Numista entry. A one pound silver dollar ended up with a Scottsdale Stacker #. Editing it showed no number in the field. I put 00000, saved it, edited again to remove the zeros and it fixed it. There was another where the number on a new entry propagated somewhere else but don't recall which one. Another entry kept defaulting to an odd number other than the $1700 I had entered:
> > > > > 
> > > > > ![Comment Image](https://preview.redd.it/what-do-you-use-to-remember-what-was-lost-in-the-boating-v0-rusf6l6y5s1h1.jpeg?width=786&format=pjpg&auto=webp&s=ba9189c7a090f3f4ef5d1f1e4143a99291b36b0a)
> > > > > 
> > > > > Kept defaulting to that. Finally changed it to each and it defaulted to $56.66667, but I was able to edit that number and save it, and it stuck. Changing it back to $1700/lot goes back to the odd number and the odd rounding error. Not that bad since I can change it. Just funny that I got bit by floating points. That's what I get for the seller saying he'll just round it down to a nice number.
> > > > > 
> > > > > Ran thru editing the vast majority of my buys to cash. Took quite a while, and brought home just how much cash I've dumped into this hobby. I will not say the number here. My son picked me up another safe. He'll bring it by when he has work in my area.
> > > > > 
> > > > > Also tried to hammer gold-api in the custom fields since all the others are severely restricted by month.
> > > > > 
> > > > > Oh yeah, one last neat thing:
> > > > > 
> > > > > > **PumpkinCrouton** · [2026-05-18](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/omei7ug/) · 1 points
> > > > > > 
> > > > > > ![Comment Image](https://preview.redd.it/what-do-you-use-to-remember-what-was-lost-in-the-boating-v0-walizdc2os1h1.jpeg?width=1532&format=pjpg&auto=webp&s=860721cc9b72eeff51ce3b320fe7fea4aa774080)
> > > > > > 
> > > > > > Had not known I could throw an icon into the name field! Don't know if it's by design or will save tonight. Still, looks pretty cool!

> **Skin4theWin** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4occr8/) · 5 points
> 
> This is awesome! Thank you for sharing with the community. I have often worried about online options and this looks awesome! Can’t wait to snag it!
> 
> > **orphenshadow** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4od816/) · 1 points
> > 
> > Thank you. When I started I made it a requirement that it be something you could stick on a thumb drive and toss in the safe. Let me know what you think, it's a little clunky but I'm constantly trying to improve it as I find things that annoy me.
> > 
> > > **Skin4theWin** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4odgj8/) · 1 points
> > > 
> > > Heck yea I’ll see how it works!

> **No-Square8315** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4ole3u/) · 4 points
> 
> I was going to offer assistance, but it seems you’re handling development just fine on your own! I’d love to check this out.

> **tim\_Andromeda** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4odcm8/) · 3 points
> 
> I like that the data never leaves the browser and no sign in required. That said I’ll probably keep using StackerScan.
> 
> > **orphenshadow** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4ohaqo/) · 1 points
> > 
> > Thank you, I actually had not seen StackerScan before it looks really awesome too. I like that they have a mobile app. I'm still wrapping my head around how all of that works.
> > 
> > I almost went down the path of the AI price lookup and I couldn't figure out how to balance that with a truly private approach.
> > 
> > > **tim\_Andromeda** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4ol0dy/) · 2 points
> > > 
> > > The mobile app is basically just a wrapper around the website.
> > > 
> > > > **orphenshadow** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4omrzb/) · 2 points
> > > > 
> > > > I need to work on mobile, my app falls apart if you try to open it on mobile the table just goes to crap. My plan is to have it dynamically switch to cards for the items when it gets smaller. I just rarely use it outside of when im at my desk making a change to inventory so I keep putting it off. I also need to build better themes.

> **Mick1014** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4p8m5k/) · 3 points
> 
> Checking this out now. Very intuitive and clearly built by a stacker. Still trying to figure out how to download locally but I'll figure it out. Thanks for sharing.
> 
> > **orphenshadow** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4pbhfb/) · 3 points
> > 
> > Thank you. I've still got a lot of ideas for the future, but in its current state you can click on the green code in the corner and there is a drop down to download the zip file, from there you can just unzip and run in a browser.
> > 
> > you don't need the python server unless you want to run https and the only reason that's really needed is for the PCGS api. which is trivial.
> > 
> > ![Comment Image](https://preview.redd.it/what-do-you-use-to-remember-what-was-lost-in-the-boating-v0-mekvqb2qzqig1.png?width=1232&format=png&auto=webp&s=ed28ceee59488165f5adc25ce320af11bd987ed0)
> > 
> > > **Mick1014** · [2026-02-11](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4pqeju/) · 2 points
> > > 
> > > Figured it out - not sure I fully understand it all (data stored locally or on server) but loving it. I need to play with it and I know where to find you for questions and feedback. Good stuff.
> > > 
> > > > **orphenshadow** · [2026-02-11](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4psfb6/) · 2 points
> > > > 
> > > > Awesome, thats good to hear!,
> > > > 
> > > > To answer this, All the data is stored in your browser cache, so if you clear your cache it will wipe it, be sure to back up/export the csv/json after you make any additions to be safe.
> > > > 
> > > > I'm working on adding some cloud storage optoins, [supabase.com](http://supabase.com/) has a free tier anyone can get that lets you have a lot of storage. for things like photos and keeping trends/history longer than the browser cache will allow. This would work like any of the other api's you would sign up for supabase and then put your key into the app to expand the storage.
> > > > 
> > > > But right now I've got almost 200 items and every api and a full year in my browser and its barely using 20% of the 5Mb you can store in chrome/firefox. So the main reason for supabase is for syncing between computers and maybe eventually adding the option to upload photos into the database.
> > > > 
> > > > > **Mick1014** · [2026-02-11](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4q2tt6/) · 1 points
> > > > > 
> > > > > I'm confused about the API. I have it all loaded buy it does not seem live if that makes sense. I feel like I never really started the software if that makes any sense.
> > > > > 
> > > > > > **orphenshadow** · [2026-02-11](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4q5697/) · 1 points
> > > > > > 
> > > > > > In the settings under API, there are a few options [Metals.dev](http://metals.dev/) has a free account you can register for and then they will give you a key, just save that key in the settings and hit save. You can drag the tabs to place them in the order if you want to set up all 3 api's but I think [metals.dev](http://metals.dev/) is the only free one. Then make sure to tick always and how long you want to cache the data, this is for free acounts that only let you download so much and also to prevent the page from making an api request every time you load it, if you set it to 1 hour for example it will auto update the price every hour when you refresh the page.
> > > > > > 
> > > > > > [Numista.com](http://numista.com/) also has an api you can get for free, this one will let you search and bring up search results from their database and add the items that way.
> > > > > > 
> > > > > > Then there is a little refresh button on the spot prices at the top you can click to have it pull the latest current spot price. Or you can Sync Metals in the api settings page.
> > > > > > 
> > > > > > Oh and you can also hold shift and click on the prices to manually input the prices yourself on the dashboard.
> > > > > > 
> > > > > > Shift clicking on most items in the table view gives you in line edits as well.
> > > > > > 
> > > > > > ![Comment Image](https://preview.redd.it/what-do-you-use-to-remember-what-was-lost-in-the-boating-v0-qsjld6xstrig1.png?width=1158&format=png&auto=webp&s=c72393a674f4dce856dd0875b07ca652602218d8)
> > > > 
> > > > > **Mick1014** · [2026-02-11](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4q2zbq/) · 1 points
> > > > > 
> > > > > Just looking to get the price moving not the rest for now.
> > > > > 
> > > > > > **orphenshadow** · [2026-02-11](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4q7mo5/) · 2 points
> > > > > > 
> > > > > > That's just the [metals.dev](http://metals.dev/) api, or [metals-api.com](http://metals-api.com/) or [metalpriceapi.com](http://metalpriceapi.com/) Once you have the code and plug it in you can refresh the price and the graphs at the top will adjust. and it will update all the melt prices, unless you specified a retail price higher than the melt.
> > > > > > 
> > > > > > > **Mick1014** · [2026-02-11](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4qbl23/) · 2 points
> > > > > > > 
> > > > > > > Thank you
> > > > 
> > > > > **recruz** · [2026-02-11](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4r1mii/) · 1 points
> > > > > 
> > > > > I haven’t looked at your export, but if desirable, it could be saved/exported in an encrypted format. That way it’s not text editor readable. Then let your app password protect it. Add it to the feature list if you so desire!
> > > > > 
> > > > > > **orphenshadow** · [2026-02-11](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4r2mpb/) · 2 points
> > > > > > 
> > > > > > currently you can export your data and all your api keys in an encrypted password protected file and re-import it as well, the csv/json are just the inventory data only.

> **PlaneAsparagus399** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4ofj1q/) · 2 points
> 
> Very cool, thank you! I'm going to try this out.

> **ironcannibal13** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4ohe17/) · 2 points
> 
> YES! Claude Code for the win!
> 
> Nice dashboard, BTW.
> 
> > **orphenshadow** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4ohs85/) · 3 points
> > 
> > I hate how good Claude is. Especially the teaching mode. Mine talks to me like a disappointed father every time I ask it to review my changes.
> > 
> > > **ironcannibal13** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4oi8y1/) · 2 points
> > > 
> > > LOL! I told mine to swear. Are you using it in the VS Code environment? Or just from command line?
> > > 
> > > > **orphenshadow** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4ojjeq/) · 2 points
> > > > 
> > > > Iterm2 on mac, with sublimetext for my editor, but for work I have to use it in vscode.

> **hexadecimaldump** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4opc2e/) · 2 points
> 
> You good silver bug are a saint. This is awesome.  
> I’ve seen others post things similar but you had to sign up, and data stored online. But with this being stand-alone and offline, I love it.
> 
> Saving this post so I can download later.
> 
> > **orphenshadow** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4orger/) · 2 points
> > 
> > That was my exact frustration as well.
> > 
> > Even the version I'm hosting is just a cloudflare static mirror of the github repo and all the data stays in the users web browser.
> > 
> > Even when I do add cloud sync, It's going to be an api based solution, Supabase is what I'm researching because It's free and anyone can sign up and get the storage.
> > 
> > I'll eventually put together a docker image and proxmox lxc for the self hosted community.

> **qwerty-mo-fu** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4pialw/) · 2 points
> 
> Excel

> **Awkwardsilence23** · [2026-02-11](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4q3b4u/) · 2 points
> 
> Gold wallet

> **Jolopy4099** · [2026-02-11](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4q9mhz/) · 2 points
> 
> Cool stuff

> **orphenshadow** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4o36ts/) · 2 points
> 
> [https://github.com/lbruton/StackTrackr](https://github.com/lbruton/StackTrackr)
> 
> [https://staktrakr.com](https://staktrakr.com/) live mirror.
> 
> > **ironcannibal13** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4ohqqo/) · 2 points
> > 
> > forked. Thank you!

> **Itchy-Pension3356** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4p0jyf/) · 1 points
> 
> This looks way better than my excel spreadsheet. When mobile app?
> 
> > **orphenshadow** · [2026-02-13](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o58bu0b/) · 2 points
> > 
> > I spent some time the last couple of days testing on mobile and trying to get it to work in a mobile browser. Right now the challenge is just backup/restore and testing. I just published the latest build with most of the mobile ui fixes.
> > 
> > My plan is to first get the desktop web version finished and at least allow web based mobile support. Then once I figure out how to do some kind of cloud sync/backup as an option a dedicated mobile app is next on the roadmap.
> > 
> > But feel free to give it a try on the web and send me a laundry list of what works and does not work and I'll do my best to give mobile some attention too. :)
> > 
> > as of v3.25.05 most basic functions should work on mobile. I need to do a lot of work refining the UI and making it a better experience. I'd love to have a barcode scanning and image upload option. But those features require some kind of storage either server side or cloud and I've so far been very focused on the offline data stays local model.
> > 
> > [https://github.com/lbruton/StackTrackr/releases/tag/v3.25.05](https://github.com/lbruton/StackTrackr/releases/tag/v3.25.05)

> **PumpkinCrouton** · [2026-02-11](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4qlvb3/) · 1 points
> 
> First sir, your programming is far above mine. I recall a CAD/CAM course in 1971, except there wasn't much in the way of CAD. Cards, and punch tape. Thus, I was basically programming by drawing mammoths on cave walls by comparison.
> 
> Like your prog, and will use it. Years of cash transactions without receipts will make my gains/losses/averages speculative at best.
> 
> Slowly figuring out your filters. Must say some of the screens don't scale well on my 85" TV/monitor @3840x2160. Have to keep zooming my browser in and out. I know, hang me with a new rope. I am impressed and appreciative. It will be monumental inputting my sparse log files individually but I like having your program to rapidly sort things. Thanks.
> 
> > **orphenshadow** · [2026-02-11](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4qt63n/) · 1 points
> > 
> > Thanks for that feedback.
> > 
> > I will have to test on my TV, it's not quite 85 :P I have been using a 1440p ultrawide and I know I had to limit how wide it would go to keep it from stretching too far.
> > 
> > The api's that I have found will only go back a year. BUT...
> > 
> > I do have in my roadmap a feature to at least let you go back a year and retrieve that days spot prices at least. I included a year of api data with todays updates and I plan on doing that every major release so that maybe in 5 years it will have 5 years of data out of the box.
> > 
> > But this brings up a good point, I think I will work on a custom CSV import tool. I built one for a tool at work so I can re-use the code. It would let you map your own spreadsheet headers to the values on import. I'll look into that this week.
> > 
> > > **PumpkinCrouton** · [2026-02-11](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4qvcuc/) · 1 points
> > > 
> > > ![Comment Image](https://preview.redd.it/what-do-you-use-to-remember-what-was-lost-in-the-boating-v0-ixch3gjqnsig1.jpeg?width=3827&format=pjpg&auto=webp&s=3af1548a7427df7508332f6970d7c59e346962ac)
> > > 
> > > Main screen fits the browser/resolution fine.
> > > 
> > > > **PumpkinCrouton** · [2026-02-11](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4qvj41/) · 2 points
> > > > 
> > > > ![Comment Image](https://preview.redd.it/what-do-you-use-to-remember-what-was-lost-in-the-boating-v0-mab9bov4osig1.jpeg?width=2785&format=pjpg&auto=webp&s=1a907502df7fa2a99c186d1d4914893f5a9952f9)
> > > > 
> > > > Think it was only this screen that didn't like it.
> > > > 
> > > > Not complaining mind you, just trying to give more detailed feedback.
> > > > 
> > > > > **orphenshadow** · [2026-02-11](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4r03fr/) · 1 points
> > > > > 
> > > > > Ah I think I see what it might be, if the browser is doing scaling. it seems. Do you happen to have your desktop or browser set to 150 or 200 % scaling? That at least gives me some ideas of things to test.
> > > > > 
> > > > > As far as the breakdown screen, That's getting a rebuild soon. this is what mine looks like on my computer at 200 zoom.
> > > > > 
> > > > > ![Comment Image](https://preview.redd.it/what-do-you-use-to-remember-what-was-lost-in-the-boating-v0-obe61574usig1.png?width=1528&format=png&auto=webp&s=e8119951590722b3613cc5b05340ccbae0de0691)
> > > > > 
> > > > > > **PumpkinCrouton** · [2026-02-11](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4tcjek/) · 1 points
> > > > > > 
> > > > > > Ah, desktop is set to 300% which windows recommends for that resolution. I just set it to 100% and text went damn near microscopic. Bearing in mind I'm across the room on the couch. Might play with it and just change around the font size later.
> > > > 
> > > > > **orphenshadow** · [2026-02-11](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4r04uk/) · 1 points
> > > > > 
> > > > > ![Comment Image](https://preview.redd.it/what-do-you-use-to-remember-what-was-lost-in-the-boating-v0-i9ttyq6busig1.png?width=1528&format=png&auto=webp&s=6f56138f7b1e41f899a72012b4ac57a065d91ea4)
> > > > > 
> > > > > and at 100 zoom., but at least I know what needs fixed :)
> 
> > **orphenshadow** · [2026-02-13](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o58aqx8/) · 1 points
> > 
> > Sorry It took awhile to get back to you, but I made several fixes in the last two days including what I hope is an improvement for you.
> > 
> > [https://github.com/lbruton/StackTrackr/releases/tag/v3.25.05](https://github.com/lbruton/StackTrackr/releases/tag/v3.25.05) is the download link for the latest version if you are running it local.
> > 
> > Or if you are running on [www.staktrakr.com](http://www.staktrakr.com/) it should be live now with that latest version.
> > 
> > > **PumpkinCrouton** · [2026-02-15](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o5jojtq/) · 1 points
> > > 
> > > Sorry to take this long. I have way too many projects.
> > > 
> > > I'll take a look see. I spent quite a while inputting some of the stack. I have little in the way of breakdowns for early acquisitions particularly pricing. Some of my early logs just say 3 gold coins, 2 10oz silver bars, 1 platinum bar in assay, this date, without a price coin dates or SN breakdown.
> > > 
> > > Originally I had input items and quantities, then considered having 2 instances with one to go by and one as an absolute inventory. Interestingly opening another separate instance in another directory brought up the same data. I assume it pulled the data from the browser.
> > > 
> > > I tried to get my grandson to come down and help me catalog all my metal, but alas, he has a life. I've been putting off getting everything sorted. Think I have the gold and platinum sorted, but again dates and prices are not matched to what I physically have. I'm going to have to have them physically in front of me to input, Otherwise I'll have all the dates wrong at a minimum. For instance, I originally input 130 ASE from a purchase. I dread eventually going back and breaking them down by dates, and others by purity.
> > > 
> > > The pie charts and data fit much better, thanks. I'll give it a better run thru. I was using Brave as a browser. Your update looks good in Chrome. I didn't try the earlier one in another browser so if I made you more work with a niche-ish browser, sorry. I'll run Chrome specifically for StackTrackr. I like that I can archive the files and load them as needed.
> > > 
> > > > **orphenshadow** · [2026-02-15](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o5jx0k4/) · 1 points
> > > > 
> > > > Ah yes, I had the same issues some of my items were just totals, others were lists like a ledger of dates i bought and for.
> > > > 
> > > > My solution to this is the copy button, If. I have 5 of one item but want to sort it out and put in the individual dates and purchase prices if I know them. I can copy the one with 5, 4 times, then edit them all to qty of 1.
> > > > 
> > > > I've spent a lot of time this week working on this issue. There is now a bulk editing page in the settings where you can mass edit items that should help out a ton.
> > > > 
> > > > I'm using firefox at home, but willing to give it a try on any browser.
> > > > 
> > > > I also added images so you can upload your own images and if you have a [numista.com](http://numista.com/) account (its free) and you sign in and go to the very bottom of that page, there is an api key you get, copy that and plug it into the settings, and you can search and match the items with numista and it will show images.
> > > > 
> > > > I've also built in the spot prices going back to 1968ish to now, and every update will include them up to the date of the update. But you can also get a free api key at [metals.dev](http://metals.dev/) and plug it into the settings and it will pull the current prices down for you when you refresh, and you can tweak how often and how long it keeps the values cached.
> > > > 
> > > > Here is a screenshot of the new view item page I've been working on, and this should work well on your TV I hope.
> > > > 
> > > > ![Comment Image](https://preview.redd.it/what-do-you-use-to-remember-what-was-lost-in-the-boating-v0-wjd5yueegpjg1.png?width=1860&format=png&auto=webp&s=8276b264fe6c40ec85bffb05e6a34d47a6afcd25)
> > > > 
> > > > > **PumpkinCrouton** · [2026-02-17](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o5sx5g8/) · 1 points
> > > > > 
> > > > > I must admit that looks sharp.
> > > > > 
> > > > > I've been using the copy button to break down my previous entries like 3 platinum bars. The copy isn't exact, it shows todays date which is neither here nor there since often I'm inputting serial numbers on the copy anyway.
> > > > > 
> > > > > I will have to consider the Numista and [Metals.dev](http://metals.dev/) apis. Perhaps with a throwaway email account. I very much fly under the radar except in here. I don't have a Google account, nothing in the cloud, VPN, custom DNS server, local storage in 2 racks etc. My phone has never been on my bank, Venmo, email, or a host of other sites. When I got a Venmo account, both VPN and Brave warned me that it could track where ever I go. Thus I only open it in PaleMoon (an old fork of Firefox)which gets scrubbed and closed when I'm done. Which yes, my Brave browser is also somewhat hardened. On this page as I type, Ghostery is intercepting 5 trees of trackers and ads and social media crap. Chrome, which I am running Stacktrakr on is somewhat hardened also, but displaying with no problems.
> > > > > 
> > > > > I was curious. I was inputting my platinum. It might be advantageous to include .9995 which is the standard 'pure' platinum. The drop down has .9999 but doesn't show .9995, and the custom option only goes 3 digits. I tried typing in .9995 but it wouldn't accept it. Changing it to something else didn't help it. Subsequently I couldn't change any data on any items and have it save it. I saved the data in all 3 formats and closed the program. On opening it back up, I imported the data and it will now allow changes again, but several hours of editing I had done to the inventory wasn't saved. I will not try that again. And the next time I save data, I will open the saved data files in another program to make certain of an accurate accounting and don't lose anything again. Sorry I broke it.
> > > > > 
> > > > > > **orphenshadow** · [2026-02-17](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o5sz0c3/) · 1 points
> > > > > > 
> > > > > > Thanks for the feedback!,
> > > > > > 
> > > > > > On the issue with the copy date being the current date, I was on the fence on that one, I think I will make that a setting you can change, so its either the original date or the current date. I was considering if you bought a new copy of something today you would want todays date, but both scenarios are worth supporting.
> > > > > > 
> > > > > > Today's updates are a HUGE update. I added some card views, improved the charts/graphs,
> > > > > > 
> > > > > > But I also added a built in free spot price API, starting about 3 hours ago you will be able to pull hourly prices and daily prices going back to 1968 for free.
> > > > > > 
> > > > > > The data lives in the web browser cache, so if you are using brave or you have chrome configured to clear your history every time you close it it would wipe the data. I'm working on adding support for optoins that let you sync to google or something similar and back up, and then I would like to have it back up every time you add/remove an item.
> > > > > > 
> > > > > > You can also export what you have so far to the csv and open it in excel and if you are good with excel you can fill in the cells you know for each item, and then save it as the .csv and re-import them all in bulk.
> > > > > > 
> > > > > > > **PumpkinCrouton** · [2026-02-17](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o5wwcfx/) · 2 points
> > > > > > > 
> > > > > > > Ok, bearing in mind that I'm probably older than your father... I had not gone to the site. I pulled the prog off github and didn't realize you had a live version running on the site. Then again, I thought I had grabbed the latest 3.30.4 from github but you're running 3.30.6 so I may just be behind the times. You're too quick for me. I may continue with the site instead of chasing and downloading revisions.
> > > > > > > 
> > > > > > > Previously, I had already saved the data in .csv, .pdf, and .json before closing the browser, due to the editing glitch. On opening the browser and the index.html, I imported the saved files, but that evening's latter edits were missing. Perhaps the missing data was related to the editing glitch, or cached and not immediately saved. I'll experiment.
> > > > > > > 
> > > > > > > The 9995 platinum purity didn't make it into the bulk editor. It gives that option when adding a new item, but is not an option in the bulk editor.
> > > > > > > 
> > > > > > > The graphs are very nice. I am curious how to get back to the list format tho. Previously, changing the screen size would eventually bring up the items with the individual graphs. Moving screen sizes back would go to the list format. That doesn't seem to be possible now or I am unaware of a switch somewhere. I find the listing to be the best way for a comprehensive and detailed view of the inventory. Style: D? Sometimes I'm wondering if I'm using the Developer version, like I have enabled on my phone. Careful of creeping featurism.
> > > > > > > 
> > > > > > > > **orphenshadow** · [2026-02-17](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o5x0nvv/) · 1 points
> > > > > > > > 
> > > > > > > > I'm in my 40's so maybe? haha.
> > > > > > > > 
> > > > > > > > The site is just a static mirror of the latest version I've pushed up. I'm still learning so it seems like every thing I fix I break something else but I'm getting the hang of it now.
> > > > > > > > 
> > > > > > > > The missing data could be related to the previous glitch, there is a delete all data button in the settings that will force wipe any cached leftovers in the browser.
> > > > > > > > 
> > > > > > > > The card view was designed to automatically switch to cards on tablet/phone, but I think your screen size is mimmicking a phone/tablet more than a computer screen.
> > > > > > > > 
> > > > > > > > I am pretty sure I can make an option for you that will toggle that off and leave a manual toggle. I did have a narrow card that was meant to be the in between for that but I was having trouble with it. :( It was all part of the push to get it to at least be readable in all sizes :)
> > > > > > > > 
> > > > > > > > The only thing I need to do to get the table to work for you is figure out a horizontal scroll. I think I should be able to have that fixed by morning, if the wife does not drag me away from the computer.
> > > > > > > > 
> > > > > > > > **orphenshadow** · [2026-02-17](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o5x1iaq/) · 1 points
> > > > > > > > 
> > > > > > > > Oh and I don't know if its mentioned anywhere but the encrypted backup that requires a password, will save all your settings not just your inventory data, so if you have a numista api key, or customize any of the many options. That's the way to go. I save an export of the CSV and that backup every time I add a few items.
> > > > > > > > 
> > > > > > > > This is also how you can move the data between your phone and your computer/tv you can drop it into your apple/google drive and then load it on the phone, where you can use the camera to add photos, and then export it again and do the transfer in reverse.
> > > > > > > > 
> > > > > > > > I'm looking into a way to let you directly attach dropbox or google drive or something as an option, but that might be several weeks or more away.
> > > > > > > > 
> > > > > > > > > **PumpkinCrouton** · [2026-02-18](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o5zzpum/) · 2 points
> > > > > > > > > 
> > > > > > > > > Outstanding. I shall use the encrypted backup then. I would have encrypted it eventually, but was still trying it out.
> > > > > > > > > 
> > > > > > > > > I do have a question. Entering Krugerrands, I used a custom purity. Krugerrands are heavy. They are 1ozt gold by weight, but alloyed with copper, thus they are actually 91.67% gold. However this seems to put the melt value off. It should be, today, ~$4925. Putting in the amended purity without entering the weight in grams: 33.93 cause a melt value of $4,479.19
> > > > > > > > > 
> > > > > > > > > I attempted to edit from 1oz to 33.93grams and ended up with this:
> > > > > > > > > 
> > > > > > > > > ![Comment Image](https://preview.redd.it/what-do-you-use-to-remember-what-was-lost-in-the-boating-v0-bm28hqfwj6kg1.jpeg?width=1156&format=pjpg&auto=webp&s=8fc5f8d7d2b8679cfba528e78c92812181305748)
> > > > > > > > > 
> > > > > > > > > The bulk edit changes the graph/display on the main page to grams, however it still continues to show it as ounces in bulk edit, and calculates melt as ounces.
> > > > > > > > > 
> > > > > > > > > I'm 69. Used to have emails for our equipment developers and the forms to print out for software changes. They would push a software 'upgrade' and some new options would appear, some would disappear forever, and some would get... funny. Came too close to losing a finger to one of their supreme ultimate upgrades that wasn't as ultimate as advertised. Called another plant and walked their tech thru the same sequence on the same equipment and got 'Holy shit!'. Of course from the software developer I got 'No, no, no. If it did that I would have never let it out the door'. Heh, I can break anything.
> > > > > > > > > 
> > > > > > > > > > **PumpkinCrouton** · [2026-02-18](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o608osi/) · 2 points
> > > > > > > > > > 
> > > > > > > > > > Deleted the single Krugerrand and input it fresh as 33.93 GRAMS with the custom purity. Looking at Bulk Edit, after adding to the inventory, listed it as 1.09oz, which is fine. However the main display graphed it correctly but tags it as 1.090875g.
> > > > > > > > > > 
> > > > > > > > > > Also my kilos, input as 32.15oz, and showing in Bulk Edit as 32.15oz show on the main page as 32.150747g. That number catches my attention. A kilogram is technically 32.1507466oz. In precious metals, 32.1505oz/kg, while not exact, is the accepted constant used for calculations. I know, why are they using the 'wrong' number? Don't ask me, I didn't do it. Since we're talking precious metals, you might want to bring your constants more in line with industry standards.
> > > > > > > > > > 
> > > > > > > > > > Don't mean to be so pedantic man, sorry.
> > > > > > > > > > 
> > > > > > > > > > **orphenshadow** · [2026-02-18](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o60n3o4/) · 1 points
> > > > > > > > > > 
> > > > > > > > > > Thank you! this is all great info to know. I'm no where near an expert to that level. I stll have all my silver quarters flubbed with the wrong weight to make the count right.
> > > > > > > > > > 
> > > > > > > > > > I did spend a little time on the bulk edit page today, not a lot but I may have fixed a couple of the issues.
> > > > > > > > > > 
> > > > > > > > > > Most of my night/day was spent trying to solve that issue with getting the table to work on any view. If you hit the site up now, you should see a much improved UI and the ability to leave the table on no matter what.
> > > > > > > > > > 
> > > > > > > > > > I also found out that it was super easy to add support for Dropbox. So people who want to sync their phone and computer can use dropbox to drop the encrypted file in a folder with one button press.
> > > > > > > > > > 
> > > > > > > > > > It sounds like the rest of my week is going to be trying to figure out why the math is not mathing.
> > > > > > > > > > 
> > > > > > > > > > I blame adding goldbacks. haha.
> > > > > 
> > > > > > **orphenshadow** · [2026-02-17](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o5tauvo/) · 1 points
> > > > > > 
> > > > > > "PumpkinCrouton Patch — Purity Input & Save Fix (v3.30.03):  
> > > > > > Added .9995 (pure platinum) to purity dropdown. Custom purity accepts 4  
> > > > > > decimal places. Fixed save corruption where hidden custom purity input  
> > > > > > blocked all form submissions. Duplicate items now preserve original  
> > > > > > purchase date. Thanks to [u/PumpkinCrouton](https://www.reddit.com/user/PumpkinCrouton/) for the report (STAK-130)"
> > > > > > 
> > > > > > [https://www.staktrakr.com](https://www.staktrakr.com/) for the live site with latest patches.
> > > > > > 
> > > > > > [https://github.com/lbruton/StakTrakr/releases](https://github.com/lbruton/StakTrakr/releases) to download the offline zip
> > > > > > 
> > > > > > [https://github.com/lbruton/StakTrakr/blob/main/about/about.md](https://github.com/lbruton/StakTrakr/blob/main/about/about.md) some screenshots and walk-through of whats where.
> > > 
> > > > **orphenshadow** · [2026-02-15](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o5kyy61/) · 1 points
> > > > 
> > > > Oh also, in regard to brave. There are probably some things being blocked if you were runnign the download version locally from file, I had to put a lot of fallbacks to get things to work and ive mostly tested in firefox/chrome. I'll install brave and see if I can figure it out, it might be a simple fix.

> **PumpkinCrouton** · [2026-02-12](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4wjc7h/) · 1 points
> 
> New inventory gives option of ounces and grams. I can put my 100oz silver bars in fine, and it converted my ¼oz gold coins to grams, which is fine. But it doesn't give the option of kilos or pounds.
> 
> I suppose I could input my pounds as 12ozt and my kilos as 32.1505ozt, but designate kilo or pound in the name to keep them sorted right.
> 
> Interestingly the list at the bottom shows my ½ounce platinum as 15.55g and the 100g Valcombi bar as 3.22oz. Top of the page lists everything in ounces.
> 
> I listed 4 German 90% coins together but the bottom listing doesn't add the weights, but shows the input weight of an individual coin of 13.88g. It apparently still accurately shows the gains and losses and melt value on the total, but doesn't show the aggregate weight. Haven't decided if this is good or not.
> 
> Taking a look at the apis. I understand it's basically to keep track of your inventory over time. Would be nice if I could yoink Kitco spot prices for the top numbers for those occasional Oh shit look how much gold dropped! events.
> 
> Boy it takes a while to input stuff from my files, but the detail is nice.

> **Longjumping-Check-76** · [2026-02-11](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4vbzpu/) · 0 points
> 
> [Good Llama](https://goodllamas.com/r/ba7d38a8-2cd7-4d6f-8972-a3852278cdf2/) can help catch deals on eBay faster than the built-in alerts. It sends real-time notifications when new listings matching your searches are posted, so you don't miss out on opportunities before prices get too rich.

> **Frequent-Finger-7611** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4o9cwh/) · \-6 points
> 
> I dont. That joke is about guns, not precious metals.
> 
> > **Next-Particular6322** · [2026-02-10](https://reddit.com/r/Silverbugs/comments/1r1aerl/comment/o4odrkk/) · 0 points
> > 
> > It’s about insurance fraud