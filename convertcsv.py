# read csv and convert it to json

# don't use pandas, use csv module instead
import csv

csv_file = 'Book1.csv'

json_list = []

def format_date(date_str):
    # from 3-Jul to July 3, 2025
    day = date_str.split('-')[0]
    return f"July {day}, 2025"

# name	date	location	start	end	host	linkname	link
with open(csv_file, mode='r', encoding='utf-8-sig') as file:
    csv_reader = csv.DictReader(file)
    for row in csv_reader:
        formatted_date = format_date(row['date'])
        formatted_start = row['start']
        formatted_end = row['end']
        json_data = {
            'title': "Cosplay:" + row['name'],
            'panelRoom': row['location'],
            'start': formatted_start,
            'end': formatted_end,
            'ticket': False,
            'panelDescription': 'Hosted by ' + row['host'] + ' Join <a href="' + row['link'] + '">' + row['linkname'] + '</a>',
            'date': formatted_date
        }

        json_list.append(json_data)

# convert to JSON

import json

json_output = json.dumps(json_list, indent=2)
print(json_output)