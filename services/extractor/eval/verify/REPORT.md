# Model check — every labelled screenshot

Model **v2** (active) run on all 181 hand-labelled screenshots (`python -m eval.verify_all`), compared with `eval/dataset/**/labels.json`.
Includes TRAIN screenshots (v2 learned their names), so name accuracy here is optimistic; the held-out TEST matches score 92.0% (training run).

| | without team list | with team list (6 matches have one) |
|---|---|---|
| Slots | 190/190 (100.0%) | 190/190 (100.0%) |
| Ranks | 792/792 (100.0%) | 792/792 (100.0%) |
| Finishes | 2993/2994 (100.0%) | 2993/2994 (100.0%) |
| Names | 3536/3713 (95.2%) | 3579/3713 (96.4%) |

Label fixes made during this check: g10/03 and g11/08 — a blank-name player row had been left out of rank 13/15.

## Per screenshot

| image | kind | names right | finishes right | problems (model read → label) |
|---|---|---|---|---|
| g01/01.jpg | RESULTS | 14/17 | 17/17 | decoration dropped: `OKANE` → `〆OKANE〆`; decoration dropped: `Gunda` → `Ｇｕｎｄａ⋆`; misread: `ZD¬jl` → `ZD¬شيفان` |
| g01/02.jpg | RESULTS | 13/18 | 18/18 | decoration dropped: `OKANE` → `〆OKANE〆`; misread: `e` → `◉Xəиoи◉`; same name, other char set: `SKYLA` → `ＳＫＹＬＡ`; misread: `叩或RAVAN` → `op或ＲＡＶＡＮ`; misread: `· Arsh` → `· Δrsħ ·` |
| g01/03.jpg | RESULTS | 17/19 | 19/19 | decoration dropped: `OKANE` → `〆OKANE〆`; misread: `MTB · Ãwan` → `MTB · Ãɯaη` |
| g01/04.jpg | RESULTS | 17/19 | 19/19 | decoration dropped: `OKANE` → `〆OKANE〆`; decoration dropped: `Saurabh` → `S͜aurabh⋆` |
| g01/05.jpg | RESULTS | 18/19 | 19/19 | decoration dropped: `OKANE` → `〆OKANE〆` |
| g01/06.jpg | RESULTS | 15/19 | 18/19 | decoration dropped: `OKANE` → `〆OKANE〆`; misread: `HARSHiTA` → `⋆HΔRSHiTΔ⋆`; finishes ⋆HΔRSHiTΔ⋆: read 8, is 6; decoration dropped: `7x` → `7x فيضان`; same name, other char set: `Lalá1` → `Lalá¹` |
| g01/07.jpg | RESULTS | 16/19 | 19/19 | decoration dropped: `OKANE` → `〆OKANE〆`; same name, other char set: `SoMeOnE` → `ＳｏＭｅＯｎＥ`; decoration dropped: `Gunda` → `Ｇｕｎｄａ⋆` |
| g02/01.jpg | RESULTS | 19/20 | 20/20 | misread: `HARSHiTA` → `⋆HΔRSHiTΔ⋆` |
| g02/02.jpg | RESULTS | 18/20 | 20/20 | misread: `HARSHiTA` → `⋆HΔRSHiTΔ⋆`; misread: `MTB · Āwan` → `MTB · Ãɯaη` |
| g02/03.jpg | RESULTS | 18/19 | 19/19 | misread: `HARSHiTA` → `⋆HΔRSHiTΔ⋆` |
| g02/04.jpg | RESULTS | 18/20 | 20/20 | misread: `HARSHiTA` → `⋆HΔRSHiTΔ⋆`; decoration dropped: `Saurabh` → `S͜aurabh⋆` |
| g02/05.jpg | RESULTS | 17/18 | 18/18 | misread: `HARSHiTA` → `⋆HΔRSHiTΔ⋆` |
| g02/06.jpg | RESULTS | 13/19 | 19/19 | misread: `HARSHiTA` → `⋆HΔRSHiTΔ⋆`; same name, other char set: `SKYLA` → `ＳＫＹＬＡ`; misread: `e` → `◉Xəиoи◉`; misread: `ZD乛slew` → `ZD¬سعاد`; misread: `ZD¬jle` → `ZD¬شيفان`; misread: `PMrs-PRAsad` → `『Mr』⟜PRAsad` |
| g02/07.jpg | RESULTS | 17/20 | 20/20 | misread: `HARSHiTA` → `⋆HΔRSHiTΔ⋆`; same name, other char set: `SoMeOnE` → `ＳｏＭｅＯｎＥ`; decoration dropped: `OKANE` → `〆OKANE〆` |
| g03/01.jpg | RESULTS | 12/15 | 15/15 | misread: `D¬` → `ZD¬شيفان`; decoration dropped: `ZD¬` → `ZD¬سوزان`; misread: `ANASOP` → `ÁÑASOP` |
| g03/02.jpg | RESULTS | 11/16 | 16/16 | misread: `D¬` → `ZD¬شيفان`; decoration dropped: `ZD¬` → `ZD¬سوزان`; misread: `ANASOP` → `ÁÑASOP`; misread: `e` → `◉Xəиoи◉`; same name, other char set: `SKYLA` → `ＳＫＹＬＡ` |
| g03/03.jpg | RESULTS | 11/16 | 16/16 | misread: `D¬` → `ZD¬شيفان`; decoration dropped: `ZD¬` → `ZD¬سوزان`; misread: `ANASOP` → `ÁÑASOP`; decoration dropped: `Saurabh` → `S͜aurabh⋆`; decoration dropped: `OKANE` → `〆OKANE〆` |
| g03/04.jpg | RESULTS | 13/16 | 16/16 | misread: `D¬` → `ZD¬شيفان`; decoration dropped: `ZD¬` → `ZD¬سوزان`; misread: `ANASOP` → `ÁÑASOP` |
| g03/05.jpg | RESULTS | 14/19 | 19/19 | decoration dropped: `ZD` → `ZD¬شيفان`; misread: `ZD¬j` → `ZD¬سوزان`; misread: `ANASOP` → `ÁÑASOP`; same name, other char set: `Lalá1` → `Lalá¹`; same name, other char set: `SoMeOnE` → `ＳｏＭｅＯｎＥ` |
| g03/06.jpg | RESULTS | 13/18 | 18/18 | misread: `D¬` → `ZD¬شيفان`; decoration dropped: `ZD¬` → `ZD¬سوزان`; misread: `ANASOP` → `ÁÑASOP`; misread: `HARSHiTA` → `⋆HΔRSHiTΔ⋆`; decoration dropped: `Gunda` → `Ｇｕｎｄａ⋆` |
| g03/07.jpg | RESULTS | 15/19 | 19/19 | misread: `D¬` → `ZD¬شيفان`; decoration dropped: `ZD¬` → `ZD¬سوزان`; misread: `ANASOP` → `ÁÑASOP`; misread: `MTB · Āwan` → `MTB · Ãɯaη` |
| g04/01.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g04/02.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g04/03.jpg | RESULTS | 17/19 | 19/19 | not read: `` → `ㅤ`; decoration dropped: `7x` → `7x فيضان` |
| g04/04.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g04/05.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g04/06.jpg | RESULTS | 18/19 | 19/19 | same name, other char set: `Mr · LaLa` → `Ｍｒ·ＬａＬａ` |
| g04/07.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g04/08.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g05/01.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g05/02.jpg | RESULTS | 19/20 | 20/20 | not read: `` → `ㅤ` |
| g05/03.jpg | RESULTS | 19/20 | 20/20 | decoration dropped: `7x` → `7x فيضان` |
| g05/04.jpg | RESULTS | 19/19 | 19/19 | ✓ all correct |
| g05/05.jpg | RESULTS | 16/17 | 17/17 | decoration dropped: `7x` → `7x فيضان` |
| g05/06.jpg | RESULTS | 17/17 | 17/17 | ✓ all correct |
| g05/07.jpg | RESULTS | 19/19 | 19/19 | ✓ all correct |
| g05/08.jpg | RESULTS | 19/20 | 20/20 | same name, other char set: `Mr · LaLa` → `Ｍｒ·ＬａＬａ` |
| g06/01.jpg | RESULTS | 17/17 | 17/17 | ✓ all correct |
| g06/02.jpg | RESULTS | 18/18 | 18/18 | ✓ all correct |
| g06/03.jpg | RESULTS | 18/19 | 19/19 | misread: `BHOSSTWALA` → `BHOSडीWALA` |
| g06/04.jpg | RESULTS | 16/16 | 16/16 | ✓ all correct |
| g06/05.jpg | RESULTS | 19/19 | 19/19 | ✓ all correct |
| g06/06.jpg | RESULTS | 18/18 | 18/18 | ✓ all correct |
| g06/07.jpg | RESULTS | 16/16 | 16/16 | ✓ all correct |
| g06/08.jpg | RESULTS | 16/18 | 18/18 | not read: `` → `ㅤ`; same name, other char set: `Mr · LaLa` → `Ｍｒ·ＬａＬａ` |
| g07/01.jpg | RESULTS | 16/16 | 16/16 | ✓ all correct |
| g07/02.jpg | RESULTS | 16/16 | 16/16 | ✓ all correct |
| g07/03.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g07/04.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g07/05.jpg | RESULTS | 17/17 | 17/17 | ✓ all correct |
| g07/06.jpg | RESULTS | 18/20 | 20/20 | misread: `· Asaulter` → `· Aꜱaulter`; decoration dropped: `NEO` → `⋆NEO⋆` |
| g07/07.jpg | RESULTS | 18/18 | 18/18 | ✓ all correct |
| g08/01.jpg | RESULTS | 16/16 | 16/16 | ✓ all correct |
| g08/02.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g08/03.jpg | RESULTS | 19/19 | 19/19 | ✓ all correct |
| g08/04.jpg | RESULTS | 19/20 | 20/20 | misread: `PixelisLive` → `PixelÌsLive` |
| g08/05.jpg | RESULTS | 19/19 | 19/19 | ✓ all correct |
| g08/06.jpg | RESULTS | 19/20 | 20/20 | misread: `BADツBDY` → `⟜BAĐツBØY` |
| g08/07.jpg | RESULTS | 16/17 | 17/17 | decoration dropped: `NEO` → `★NEO★` |
| g09/01.jpg | RESULTS | 19/20 | 20/20 | misread: `TSxALoNε` → `TSxAʟᴏɴɛ` |
| g09/02.jpg | RESULTS | 19/20 | 20/20 | misread: `TSxALoNε` → `TSxAʟᴏɴɛ` |
| g09/03.jpg | RESULTS | 16/18 | 18/18 | misread: `TSxALoNε` → `TSxAʟᴏɴɛ`; misread: `PHPENIX三x` → `PHØËÑÎX彡x` |
| g09/04.jpg | RESULTS | 19/20 | 20/20 | misread: `TSxALoNε` → `TSxAʟᴏɴɛ` |
| g09/05.jpg | RESULTS | 19/20 | 20/20 | misread: `TSxALoNε` → `TSxAʟᴏɴɛ` |
| g09/06.jpg | RESULTS | 18/19 | 19/19 | misread: `TSxALoNε` → `TSxAʟᴏɴɛ` |
| g09/07.jpg | RESULTS | 18/20 | 20/20 | misread: `TSxALoNε` → `TSxAʟᴏɴɛ`; decoration dropped: `DEMON` → `★DEMON★` |
| g10/01.jpg | SLOT_LIST | 32/34 | — | misread: `LEGACY` → `ʟɛɢᴧᴄʏ★`; decoration dropped: `Nova` → `ـــﮩNova` |
| g10/02.jpg | SLOT_LIST | 31/32 | — | misread: `TSxALONE` → `TSxAʟᴏɴɛ` |
| g10/03.jpg | RESULTS | 18/20 | 20/20 | misread: `LEGACY` → `ʟɛɢᴧᴄʏ★`; not read: `` → `ㅤ` |
| g10/04.jpg | RESULTS | 17/19 | 19/19 | misread: `LEGACY` → `ʟɛɢᴧᴄʏ★`; decoration dropped: `Nova` → `ـــﮩNova` |
| g10/05.jpg | RESULTS | 16/18 | 18/18 | misread: `LEGACY` → `ʟɛɢᴧᴄʏ★`; decoration dropped: `Nova` → `ـــﮩNova` |
| g10/06.jpg | RESULTS | 19/20 | 20/20 | misread: `LEGACY` → `ʟɛɢᴧᴄʏ★` |
| g10/07.jpg | RESULTS | 18/20 | 20/20 | misread: `LEGACY` → `ʟɛɢᴧᴄʏ★`; misread: `TSxALONE` → `TSxAʟᴏɴɛ` |
| g10/08.jpg | RESULTS | 17/18 | 18/18 | misread: `LEGACY` → `ʟɛɢᴧᴄʏ★` |
| g10/09.jpg | RESULTS | 18/19 | 19/19 | misread: `LEGACY` → `ʟɛɢᴧᴄʏ★` |
| g10/10.jpg | RESULTS | 18/19 | 19/19 | misread: `LEGACY` → `ʟɛɢᴧᴄʏ★` |
| g10/11.jpg | SLOT_LIST | 32/33 | — | decoration dropped: `Nova` → `ـــﮩNova` |
| g11/01.jpg | RESULTS | 17/17 | 17/17 | ✓ all correct |
| g11/02.jpg | RESULTS | 18/18 | 18/18 | ✓ all correct |
| g11/03.jpg | RESULTS | 16/16 | 16/16 | ✓ all correct |
| g11/04.jpg | SLOT_LIST | 23/23 | — | ✓ all correct |
| g11/05.jpg | SLOT_LIST | 33/33 | — | ✓ all correct |
| g11/06.jpg | RESULTS | 17/17 | 17/17 | ✓ all correct |
| g11/07.jpg | SLOT_LIST | 33/34 | — | misread: `TSxALoNε` → `TSxAʟᴏɴɛ` |
| g11/08.jpg | RESULTS | 17/18 | 18/18 | not read: `` → `ㅤ` |
| g11/09.jpg | RESULTS | 17/17 | 17/17 | ✓ all correct |
| g12/01.jpg | RESULTS | 17/17 | 17/17 | ✓ all correct |
| g12/02.jpg | SLOT_LIST | 34/35 | — | misread: `LEGACY` → `ʟɛɢᴧᴄʏ★` |
| g12/03.jpg | RESULTS | 18/18 | 18/18 | ✓ all correct |
| g12/04.jpg | SLOT_LIST | 28/28 | — | ✓ all correct |
| g12/05.jpg | RESULTS | 17/18 | 18/18 | misread: `LEGACY` → `ʟɛɢᴧᴄʏ★` |
| g12/06.jpg | RESULTS | 15/16 | 16/16 | misread: `TSxALONE` → `TSxAʟᴏɴɛ` |
| g12/07.jpg | RESULTS | 18/18 | 18/18 | ✓ all correct |
| g12/08.jpg | SLOT_LIST | 30/32 | — | same name, other char set: `In s i` → `Ｉｎｓｉ`; misread: `TSxALONE` → `TSxAʟᴏɴɛ` |
| g12/09.jpg | RESULTS | 15/16 | 16/16 | same name, other char set: `Insi` → `Ｉｎｓｉ` |
| g12/10.jpg | RESULTS | 17/17 | 17/17 | ✓ all correct |
| g13/01.jpg | RESULTS | 16/17 | 17/17 | misread: `MrSe-NoVa` → `▢MrS⊸NoVa▢` |
| g13/02.jpg | RESULTS | 18/20 | 20/20 | misread: `DEVILe-SK` → `Dεᴠɪʟ⊸ŠK`; misread: `TSxALONE` → `TSxAʟᴏɴɛ` |
| g13/03.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g13/04.jpg | RESULTS | 19/20 | 20/20 | misread: `Fls OP` → `Fł�s OP` |
| g13/05.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g13/06.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g13/07.jpg | RESULTS | 19/20 | 20/20 | decoration dropped: `《MadMax` → `ӂØӂ 《MadMax` |
| g14/01.jpg | RESULTS | 17/19 | 19/19 | misread: `Fls OP` → `Fł�s OP`; decoration dropped: `《MadMax` → `ӂØӂ 《MadMax` |
| g14/02.jpg | RESULTS | 17/18 | 18/18 | misread: `Fls OP` → `Fł�s OP` |
| g14/03.jpg | RESULTS | 17/19 | 19/19 | misread: `Fls OP` → `Fł�s OP`; misread: `MrSe-NoVa` → `▢MrS⊸NoVa▢` |
| g14/04.jpg | RESULTS | 16/19 | 19/19 | misread: `Fls OP` → `Fł�s OP`; misread: `DEvlLe-ŠK` → `Dεᴠɪʟ⊸ŠK`; misread: `TSxALONE` → `TSxAʟᴏɴɛ` |
| g14/05.jpg | RESULTS | 17/18 | 18/18 | misread: `Fls OP` → `Fł�s OP` |
| g14/06.jpg | RESULTS | 18/19 | 19/19 | misread: `Fls OP` → `Fł�s OP` |
| g14/07.jpg | RESULTS | 18/19 | 19/19 | misread: `Fls OP` → `Fł�s OP` |
| g15/01.jpg | SLOT_LIST | 35/35 | — | ✓ all correct |
| g15/02.jpg | SLOT_LIST | 35/35 | — | ✓ all correct |
| g16/01.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g16/02.jpg | RESULTS | 16/16 | 16/16 | cut-off block read ([14]) |
| g16/03.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g16/04.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g16/05.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g16/06.jpg | RESULTS | 16/16 | 16/16 | cut-off block read ([11]) |
| g17/01.jpg | RESULTS | 19/19 | 19/19 | ✓ all correct |
| g17/02.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g17/03.jpg | RESULTS | 19/19 | 19/19 | ✓ all correct |
| g17/04.jpg | RESULTS | 19/20 | 20/20 | misread: `BÄBYe` → `⟜BÄBŸ⟜` |
| g17/05.jpg | RESULTS | 18/20 | 20/20 | decoration dropped: `WRLD乛MERCY` → `WRLD¬MERCY`; misread: `hell×Paddy` → `ɧɛllメPaddy` |
| g17/06.jpg | RESULTS | 19/20 | 20/20 | decoration dropped: `SHUBH` → `⋆ SHUBH ⋆` |
| g17/07.jpg | RESULTS | 19/20 | 20/20 | misread: `〖Mohan` → `〖Ṁohan〗` |
| g18/01.jpg | RESULTS | 19/19 | 19/19 | ✓ all correct |
| g18/02.jpg | RESULTS | 19/20 | 20/20 | misread: `〖Mohan` → `〖Ṁohan〗` |
| g18/03.jpg | RESULTS | 18/19 | 19/19 | decoration dropped: `SHUBH` → `⋆ SHUBH ⋆` |
| g18/04.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g18/05.jpg | RESULTS | 19/20 | 20/20 | decoration dropped: `WRLD乛MERCY` → `WRLD¬MERCY` |
| g18/06.jpg | RESULTS | 17/17 | 17/17 | ✓ all correct |
| g18/07.jpg | SLOT_LIST | 33/34 | — | decoration dropped: `WRLD乛MERCY` → `WRLD¬MERCY` |
| g18/08.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g18/09.jpg | SLOT_LIST | 34/36 | — | decoration dropped: `SHUBH` → `⋆ SHUBH ⋆`; misread: `〖Mohan` → `〖Ṁohan〗` |
| g18/10.jpg | SLOT_LIST | 23/24 | — | decoration dropped: `WRLD乛MERCY` → `WRLD¬MERCY` |
| g19/01.jpg | RESULTS | 15/17 | 17/17 | decoration dropped: `SHUBH` → `⋆ SHUBH ⋆`; misread: `〖Mohan` → `〖Ṁohan〗` |
| g19/02.jpg | RESULTS | 14/16 | 16/16 | decoration dropped: `SHUBH` → `⋆ SHUBH ⋆`; misread: `〖Mohan` → `〖Ṁohan〗` |
| g19/03.jpg | RESULTS | 18/20 | 20/20 | decoration dropped: `SHUBH` → `⋆ SHUBH ⋆`; misread: `〖Mohan` → `〖Ṁohan〗` |
| g19/04.jpg | RESULTS | 18/20 | 20/20 | decoration dropped: `SHUBH` → `⋆ SHUBH ⋆`; misread: `〖Mohan` → `〖Ṁohan〗` |
| g19/05.jpg | RESULTS | 17/19 | 19/19 | decoration dropped: `SHUBH` → `⋆ SHUBH ⋆`; misread: `〖Mohan` → `〖Ṁohan〗` |
| g19/06.jpg | RESULTS | 18/20 | 20/20 | decoration dropped: `SHUBH` → `⋆ SHUBH ⋆`; misread: `〖Mohan` → `〖Ṁohan〗` |
| g19/07.jpg | RESULTS | 17/19 | 19/19 | decoration dropped: `SHUBH` → `⋆ SHUBH ⋆`; misread: `〖Mohan` → `〖Ṁohan〗` |
| g19/08.jpg | RESULTS | 14/17 | 17/17 | decoration dropped: `SHUBH` → `⋆ SHUBH ⋆`; misread: `〖Mohan` → `〖Ṁohan〗`; decoration dropped: `WRLD乛MERCY` → `WRLD¬MERCY` |
| g20/01.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g20/02.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g20/03.jpg | RESULTS | 18/19 | 19/19 | decoration dropped: `SHUBH` → `⋆ SHUBH ⋆` |
| g20/04.jpg | RESULTS | 17/18 | 18/18 | misread: `〖Mohan` → `〖Ṁohan〗` |
| g20/05.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g20/06.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g20/07.jpg | RESULTS | 19/19 | 19/19 | ✓ all correct |
| g21/01.jpg | RESULTS | 18/20 | 20/20 | misread: `आशीषर` → `आशीष्`; misread: `Keuer2` → `ʎeɯɹer2` |
| g21/02.jpg | RESULTS | 16/16 | 16/16 | cut-off block read ([9]) |
| g21/03.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g21/04.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g21/05.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g21/06.jpg | RESULTS | 19/19 | 19/19 | ✓ all correct |
| g21/07.jpg | SLOT_LIST | 36/36 | — | ✓ all correct |
| g21/08.jpg | SLOT_LIST | 29/31 | — | misread: `Keuler2` → `ʎeɯɹer2`; misread: `आशीष२` → `आशीष्` |
| g21/09.jpg | SLOT_LIST | 29/31 | — | misread: `Keuler2` → `ʎeɯɹer2`; misread: `आशीष२` → `आशीष्` |
| g21/10.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g21/11.jpg | RESULTS | 19/19 | 19/19 | ✓ all correct |
| g21/12.jpg | RESULTS | 18/20 | 20/20 | misread: `Keuer2` → `ʎeɯɹer2`; misread: `आशीषर` → `आशीष्` |
| g21/13.jpg | SLOT_LIST | 36/36 | — | ✓ all correct |
| g21/14.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g21/15.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g21/16.jpg | RESULTS | 19/19 | 19/19 | ✓ all correct |
| g21/17.jpg | SLOT_LIST | 35/35 | — | ✓ all correct |
| g21/18.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g21/19.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g21/20.jpg | RESULTS | 19/19 | 19/19 | ✓ all correct |
| g21/21.jpg | RESULTS | 19/19 | 19/19 | ✓ all correct |
| g21/22.jpg | RESULTS | 18/20 | 20/20 | misread: `ama` → `ʎeɯɹer2`; misread: `3π2f可々` → `आशीष्` |
| g21/23.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| g21/24.jpg | SLOT_LIST | 33/35 | — | misread: `Kewuer2` → `ʎeɯɹer2`; misread: `आशीष२` → `आशीष्` |
| real/lobby-1.jpg | SLOT_LIST | 36/36 | — | ✓ all correct |
| real/lobby-2.jpg | SLOT_LIST | 29/31 | — | misread: `Keuler2` → `ʞeɯɹer2`; misread: `आशीष२` → `आशीष्` |
| real/result-1.jpg | RESULTS | 19/19 | 19/19 | ✓ all correct |
| real/result-2.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| real/result-3.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
| real/result-4.jpg | RESULTS | 18/20 | 20/20 | misread: `आशीषर` → `आशीष्`; misread: `Keuer2` → `ʞeɯɹer2` |
| real/result-5.jpg | RESULTS | 20/20 | 20/20 | ✓ all correct |
