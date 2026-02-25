module.exports = {
  // User Roles
  ROLES: {
    STUDENT: 'STUDENT',
    TEACHER: 'TEACHER',
    ADMIN: 'ADMIN',
  },

  // Attendance Status
  ATTENDANCE_STATUS: {
    PRESENT: 'PRESENT',
    ABSENT: 'ABSENT',
    LATE: 'LATE',
  },

  // Lecture Status
  LECTURE_STATUS: {
    SCHEDULED: 'SCHEDULED',
    ONGOING: 'ONGOING',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
  },

  // Attendance Request Status
  REQUEST_STATUS: {
    ACTIVE: 'ACTIVE',
    EXPIRED: 'EXPIRED',
    CLOSED: 'CLOSED',
  },

  // Semesters
  SEMESTERS: {
    FALL: 'Fall',
    SPRING: 'Spring',
    SUMMER: 'Summer',
  },

  // Days of Week
  DAYS_OF_WEEK: {
    SUNDAY: 0,
    MONDAY: 1,
    TUESDAY: 2,
    WEDNESDAY: 3,
    THURSDAY: 4,
    FRIDAY: 5,
    SATURDAY: 6,
  },

  // Cloudinary Folders
  CLOUDINARY_FOLDERS: {
    FACES: 'attendance/faces',
    VOICES: 'attendance/voices',
    ATTENDANCE: 'attendance/records',
  },

  // Verification Methods
  VERIFICATION_METHODS: {
    FACE: 'FACE',
    VOICE: 'VOICE',
    MANUAL: 'MANUAL',
    GPS: 'GPS',
  },

  // Default Values
  DEFAULTS: {
    ATTENDANCE_REQUEST_DURATION: 5, // minutes
    MAX_SECTION_CAPACITY: 100,
    MIN_CONFIDENCE_SCORE: 0.6,
    LATE_THRESHOLD_MINUTES: 10,
  },
};
