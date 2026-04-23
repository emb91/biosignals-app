#!/bin/bash

WEBHOOK="https://api.clay.com/v3/sources/webhook/pull-in-data-from-a-webhook-9e849e00-6838-4da3-b4eb-f862e035960b"

send() {
  curl -s -o /dev/null -w "%s → %{http_code}\n" -X POST "$WEBHOOK" \
    -H "Content-Type: application/json" \
    -d "$1"
}

send '{"full_name":"Elizabeth Yarber","first_name":"Elizabeth","last_name":"Yarber","company_name":"AOA Dx","job_title":"Senior Director Clinical Operations","location":"United States","company_domain":"aoadx.com","linkedin_url":"https://www.linkedin.com/in/elizabethyarber/"}'

send '{"full_name":"David Kurtz","first_name":"David","last_name":"Kurtz","company_name":"Foresight Diagnostics","job_title":"Chief Medical Officer and Head of Research","location":"Palo Alto, California, United States","company_domain":"foresight-dx.com","linkedin_url":"https://www.linkedin.com/in/david-kurtz-0333254b/"}'

send '{"full_name":"Kimberly Chau","first_name":"Kimberly","last_name":"Chau","company_name":"Exai Bio","job_title":"VP, Clinical Operations","location":"San Jose, California, United States","company_domain":"exai.bio","linkedin_url":"https://www.linkedin.com/in/kimberly-chau-8213481/"}'

send '{"full_name":"Eric Kaldjian","first_name":"Eric","last_name":"Kaldjian","company_name":"RareCyte, Inc.","job_title":"SVP Clinical Research","location":"Ann Arbor, Michigan, United States","company_domain":"rarecyte.com","linkedin_url":"https://www.linkedin.com/in/eric-kaldjian-11130844/"}'

send '{"full_name":"Adam Benson","first_name":"Adam","last_name":"Benson","company_name":"Droplet Biosciences, Inc","job_title":"Senior Director Clinical Operations","location":"Cambridge, Massachusetts, United States","company_domain":"dropletbiosci.com","linkedin_url":"https://www.linkedin.com/in/adam-benson-63828411/"}'

echo "Done."
