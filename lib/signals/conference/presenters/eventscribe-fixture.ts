/**
 * Static fixture: a trimmed slice of the live ASCPT 2026 eventScribe FullSchedule
 * HTML (https://ascpt2026.eventscribe.net/agenda.asp?pfp=FullSchedule&all=1,
 * captured 2026-06-24). Preserves the exact nesting that makes naive block-split
 * title attribution wrong: the "Speaker Ready Room" row's first .list-row-primary
 * span precedes the "Opening Session" presenters, so nearest-preceding-title
 * attribution is required. Used for the no-network parser test.
 */
export const EVENTSCRIBE_ASCPT2026_FIXTURE = `<li class="list-group-item list-row loadbyurl " data-url="ajaxcalls/PresentationInfo.asp?PresentationID=1752904" data-presid="1752904" data-buildcode="G" >
  <div class="list-row-content"><div class="list-row-secondary prestime"><span class="tipsytip" title="">12:00 PM - 6:30 PM <small>MST</small></span></div><div class="list-row-primary"><span style="color:#5a5a5a">Speaker Ready Room</span><div class="text-12">Location:   Crest 2</div></div></div>
  <div class="list-row-fav"></div></li></div><li class="list-group-item list-row bucket" data-showhide='hide'  >
  <div class="list-row-content"><div class="list-row-secondary prestime"><span class="tipsytip" title="">3:00 PM - 5:00 PM <small>MST</small></span></div><div class="list-row-primary"><span style="color:#5a5a5a">Opening Session (brought to you by Pfizer)</span><section class="text-12"><div><div class="mar-btm-xs">Chair: <a class="loadbyurl popup-link" data-url="/ajaxcalls/presenterInfo.asp?HPRID=830451">Sandra A.G Visser, PhD (she/her/hers)</a> &ndash; Quantivis LLC, ASCPT President</div><div class="mar-btm-xs">Award Recipient: <a class="loadbyurl popup-link" data-url="/ajaxcalls/presenterInfo.asp?HPRID=1154047">Brian W. Corrigan, PhD</a> &ndash; Metrum RG</div><div class="mar-btm-xs">Award Recipient: <a class="loadbyurl popup-link" data-url="/ajaxcalls/presenterInfo.asp?HPRID=2172863">Sarah Kim, PhD (she/her/hers)</a> &ndash; University of Florida</div><div class="mar-btm-xs">Award Recipient: <a class="loadbyurl popup-link" data-url="/ajaxcalls/presenterInfo.asp?HPRID=830452">Kellie S. Reynolds, PharmD</a></div><div class="mar-btm-xs">Award Recipient: <a class="loadbyurl popup-link" data-url="/ajaxcalls/presenterInfo.asp?HPRID=853153">Dan M. Roden, MD</a> &ndash; Vanderbilt University Medical Center</div></div></section></div></div></li>
  <li class="list-group-item list-row bucket" data-showhide='hide'  >
  <div class="list-row-content"><div class="list-row-primary"><span style="color:#5a5a5a">Moderated Poster Session: Pharmacometrics</span><section class="text-12"><div><div class="mar-btm-xs">Moderator: <a class="loadbyurl popup-link" data-url="/ajaxcalls/presenterInfo.asp?HPRID=2811150">Gwenn S. Smith, PhD (she/her/hers)</a> &ndash; Johns Hopkins School of Medicine</div></div></section></div></div></li>`;

/** The 404 shell eventScribe returns for an unpublished/unknown event slug. */
export const EVENTSCRIBE_404_SHELL = `<!DOCTYPE html><html><head><title>Not Found</title></head><body>The event you are looking for could not be found.</body></html>`;
