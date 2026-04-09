db.appsettings.updateOne({}, {
  $set: {
    systemEmailHost: "smtp.gmail.com",
    systemEmailPort: 465,
    systemEmailSecure: true,
    systemEmailPassword: "lnblwqtvqvzadxqo"
  }
})