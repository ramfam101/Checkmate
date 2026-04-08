# Notes for features to implement

The goal is to expand Checkmate's existing notification system by
implementing escalated notifications, a mechanism that allows
users to define alert times for issues based on duration of an
incident. 

Rather than simply firing a single alert when a monitor
goes down, escalated alerts will ensure that the right people are
notified at the right time as an issue persists. 

As of right now there is a bug in the repo where a “Monitor ___ is
back up” email comes before the “Monitor ____ is down” email.

Features that must be implemented:
* Escalated notification setting - Frontend implementation
* Escalated notification is properly saved along with monitor
information, persists upon reload. - Backend implementation
* Email notification sent according to escalated notification
channel

## Front End Description

Title: Escalation Rules
Subtitle: If the monitor stays down for the specified time, notify additional channels

Entry 1: Escaleate after (minutes) 
- text entry to input number 

Entry 2: Escaltion notification channels 
- dropbox of notification channels 
- after selecting a channel, it get listed underneath the dropbox and has a trashcan button at the far right to remove the channel 
- similar to the other email feature 

## Email Description

### Email when service has been down for escalation time

Title: Escalation: "title of service" still down